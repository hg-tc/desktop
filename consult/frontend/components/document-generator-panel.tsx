"use client"

import { useEffect, useMemo, useRef, useState } from 'react'

type Stage = 'react_requirements_synthesis' | 'web_search_collect' | 'triage_and_filter' | 'doc_assessment' | 'questionnaire'

const STAGES: Stage[] = [
  'react_requirements_synthesis',
  'web_search_collect',
  'triage_and_filter',
  'doc_assessment',
  'questionnaire',
]

export function DocumentGeneratorPanel() {
  const [workspaceId, setWorkspaceId] = useState('global')
  const [companyName, setCompanyName] = useState('')
  const [projectsText, setProjectsText] = useState('')
  const [knownInfo, setKnownInfo] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [assessmentMd, setAssessmentMd] = useState('')
  const [questionnaireMd, setQuestionnaireMd] = useState('')

  const [currentStageIdx, setCurrentStageIdx] = useState<number>(-1)
  const esRef = useRef<EventSource | null>(null)

  const percent = useMemo(() => {
    if (currentStageIdx < 0) return 0
    const base = Math.floor(((currentStageIdx) / (STAGES.length)) * 100)
    return Math.min(100, Math.max(0, base))
  }, [currentStageIdx])

  const openSSE = (ws: string) => {
    // 关闭旧连接
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
    }
    const url = `/api/v1/stream/progress?topic=questionnaire-builder&workspace_id=${encodeURIComponent(ws)}`
    const es = new EventSource(url)
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data)
        const idx = STAGES.indexOf(data.stage)
        if (idx >= 0) {
          setCurrentStageIdx(data.status === 'end' ? idx + 1 : idx)
        }
      } catch {}
    }
    es.onerror = () => {
      // 断线后尝试重连：简单回退，稍后由新请求再次建立
      es.close()
      esRef.current = null
    }
    esRef.current = es
  }

  const handleGenerate = async () => {
    setError(null)
    setAssessmentMd('')
    setQuestionnaireMd('')
    setCurrentStageIdx(0)
    setLoading(true)
    openSSE(workspaceId || 'global')
    try {
      const target_projects = projectsText.split('\n').map(s => s.trim()).filter(Boolean)
      const known = knownInfo ? JSON.parse(knownInfo) : {}
      const res = await fetch('/api/apps/questionnaire-builder/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspace_id: workspaceId || 'global', company_name: companyName, target_projects, known_info: known })
      })
      if (!res.ok) throw new Error(`请求失败: ${res.status}`)
      const data = await res.json()
      setAssessmentMd(data.assessment_overview_md || '')
      setQuestionnaireMd(data.questionnaire_md || '')
      setCurrentStageIdx(STAGES.length)
    } catch (e: any) {
      setError(e?.message || '请求失败')
    } finally {
      setLoading(false)
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
    }
  }

  const download = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-4">问卷生成</h2>
        <p className="text-gray-600 mb-6">输入企业与目标项目，系统生成评估报告与问卷（支持实时进度）。</p>
      </div>

      {/* 输入区 */}
      <div className="bg-white p-6 rounded-lg border shadow-sm space-y-4">
        <div className="grid md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-2">工作区 ID</label>
            <input className="w-full px-3 py-2 border rounded-md" value={workspaceId} onChange={e => setWorkspaceId(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">企业名称</label>
            <input className="w-full px-3 py-2 border rounded-md" value={companyName} onChange={e => setCompanyName(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium mb-2">目标项目（每行一个）</label>
            <textarea className="w-full px-3 py-2 border rounded-md h-[88px]" value={projectsText} onChange={e => setProjectsText(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">已知信息 JSON（可选）</label>
          <textarea className="w-full px-3 py-2 border rounded-md h-[88px]" placeholder='{"region":"深圳"}' value={knownInfo} onChange={e => setKnownInfo(e.target.value)} />
        </div>
        <button onClick={handleGenerate} disabled={loading || !projectsText.trim()} className="w-full px-4 py-3 bg-primary text-white rounded-md hover:bg-primary/90 disabled:opacity-50">{loading ? '生成中...' : '开始生成'}</button>
      </div>

      {/* 进度条 */}
      <div className="bg-white p-4 rounded-lg border">
        <div className="flex items-center justify-between mb-2 text-sm text-gray-600">
          {STAGES.map((s, i) => (
            <div key={s} className={`flex-1 text-center ${i <= currentStageIdx - 1 ? 'text-primary font-medium' : ''}`}>{i + 1}. {s}</div>
          ))}
        </div>
        <div className="w-full bg-gray-100 h-2 rounded">
          <div className="h-2 rounded bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
      </div>

      {/* 评估报告 */}
      {assessmentMd && (
        <div className="bg-white p-6 rounded-lg border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">📋 评估报告</h3>
            <div className="space-x-2">
              <button onClick={() => navigator.clipboard.writeText(assessmentMd)} className="px-3 py-1 text-sm bg-gray-700 text-white rounded">复制</button>
              <button onClick={() => download(assessmentMd, 'assessment.md')} className="px-3 py-1 text-sm bg-primary text-white rounded">下载 .md</button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded max-h-[60vh] overflow-auto">{assessmentMd}</pre>
        </div>
      )}

      {/* 问卷 */}
      {questionnaireMd && (
        <div className="bg-white p-6 rounded-lg border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold">📝 问卷</h3>
            <div className="space-x-2">
              <button onClick={() => navigator.clipboard.writeText(questionnaireMd)} className="px-3 py-1 text-sm bg-gray-700 text-white rounded">复制</button>
              <button onClick={() => download(questionnaireMd, 'questionnaire.md')} className="px-3 py-1 text-sm bg-primary text-white rounded">下载 .md</button>
            </div>
          </div>
          <pre className="whitespace-pre-wrap text-sm bg-gray-50 p-4 rounded max-h-[60vh] overflow-auto">{questionnaireMd}</pre>
        </div>
      )}
    </div>
  )
}

