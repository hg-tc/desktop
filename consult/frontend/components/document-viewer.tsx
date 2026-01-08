"use client"

import React, { useState, useEffect } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { X, Download, ExternalLink, FileText, ChevronLeft, ChevronRight, Eye } from "lucide-react"
import { LoadingState } from "@/components/ui/loading-state"

interface DocumentPreview {
  doc_id: string
  chunk_id?: string
  content: string
  metadata: Record<string, any>
  highlight?: string
  preview_url: string
}

interface DocumentViewerProps {
  documentId: string
  chunkId?: string
  highlight?: string
  onClose?: () => void
  className?: string
  sourceType?: 'global' | 'workspace'
  workspaceId?: string
}

export function DocumentViewer({ 
  documentId, 
  chunkId, 
  highlight, 
  onClose,
  className = "",
  sourceType = 'global',
  workspaceId
}: DocumentViewerProps) {
  const [preview, setPreview] = useState<DocumentPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  useEffect(() => {
    if (documentId) {
      loadPreview()
    }
  }, [documentId, chunkId, highlight])
  
  const loadPreview = async () => {
    setLoading(true)
    setError(null)
    
    try {
      const params = new URLSearchParams()
      if (chunkId) params.append('chunk_id', chunkId)
      if (highlight) params.append('highlight', highlight)
      
      // 根据sourceType选择正确的API路径
      const apiPath = sourceType === 'global' 
        ? `/api/global/documents/${documentId}/preview`
        : `/api/workspaces/${workspaceId}/documents/${documentId}/preview`
      
      const response = await fetch(`${apiPath}?${params}`)
      const data = await response.json()
      
      if (data.error) {
        setError(data.error)
      } else {
        setPreview(data)
      }
    } catch (err) {
      setError('加载文档预览失败')
      console.error('Document preview error:', err)
    } finally {
      setLoading(false)
    }
  }
  
  const handleDownload = async () => {
    try {
      // 根据sourceType选择正确的API路径
      const apiPath = sourceType === 'global' 
        ? `/api/global/documents/${documentId}/download`
        : `/api/workspaces/${workspaceId}/documents/${documentId}/download`
      
      const response = await fetch(apiPath)
      const data = await response.json()
      
      if (data.error) {
        console.error('Download error:', data.error)
        return
      }
      
      // 创建下载链接
      const link = document.createElement('a')
      link.href = data.download_url
      link.download = data.original_filename
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (err) {
      console.error('Download failed:', err)
    }
  }
  
  const renderContent = () => {
    if (!preview) return null
    
    // 如果内容包含HTML标签（高亮），直接渲染
    if (preview.content.includes('<mark')) {
      return (
        <div 
          className="prose prose-sm max-w-none"
          dangerouslySetInnerHTML={{ __html: preview.content }}
        />
      )
    }
    
    // 否则渲染纯文本
    return (
      <div className="prose prose-sm max-w-none whitespace-pre-wrap">
        {preview.content}
      </div>
    )
  }
  
  return (
    <div className={`fixed inset-0 bg-black/50 flex items-center justify-center z-50 ${className}`}>
      <Card className="w-full max-w-4xl max-h-[90vh] bg-card border-border shadow-lg">
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            <h2 className="text-lg font-semibold text-foreground">
              {preview?.metadata?.original_filename || `文档 ${documentId}`}
            </h2>
            {preview?.metadata?.file_type && (
              <Badge variant="secondary" className="text-xs">
                {preview.metadata.file_type.toUpperCase()}
              </Badge>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              className="h-8 px-2"
            >
              <Download className="w-4 h-4 mr-1" />
              下载
            </Button>
            
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.open(preview?.preview_url, '_blank')}
              className="h-8 px-2"
            >
              <ExternalLink className="w-4 h-4 mr-1" />
              新窗口
            </Button>
            
            {onClose && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="h-8 px-2"
              >
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
        </div>
        
        <div className="p-4 overflow-y-auto max-h-[calc(90vh-80px)]">
          {loading && (
            <LoadingState className="py-8" message="加载中..." />
          )}
          
          {error && (
            <div className="text-center py-8">
              <div className="text-destructive mb-2">{error}</div>
              <Button variant="outline" size="sm" onClick={loadPreview}>
                重试
              </Button>
            </div>
          )}
          
          {preview && !loading && !error && (
            <div className="space-y-4">
              {/* 文档元信息 */}
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                {preview.metadata?.file_size && (
                  <span>大小: {Math.round(preview.metadata.file_size / 1024)} KB</span>
                )}
                {preview.metadata?.page_number && (
                  <span>页码: {preview.metadata.page_number}</span>
                )}
                {preview.metadata?.upload_time && (
                  <span>上传时间: {new Date(preview.metadata.upload_time).toLocaleDateString()}</span>
                )}
              </div>
              
              {/* 高亮关键词 */}
              {preview.highlight && (
                <div className="p-2 bg-yellow-50 border border-yellow-200 rounded">
                  <span className="text-sm text-yellow-800">
                    高亮关键词: <strong>{preview.highlight}</strong>
                  </span>
                </div>
              )}
              
              {/* 文档内容 */}
              <div className="border border-border rounded-lg p-4 bg-background">
                {renderContent()}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}

interface DocumentViewerModalProps {
  isOpen: boolean
  documentId?: string
  chunkId?: string
  highlight?: string
  onClose: () => void
}

export function DocumentViewerModal({ 
  isOpen, 
  documentId, 
  chunkId, 
  highlight, 
  onClose 
}: DocumentViewerModalProps) {
  if (!isOpen || !documentId) return null
  
  return (
    <DocumentViewer
      documentId={documentId}
      chunkId={chunkId}
      highlight={highlight}
      onClose={onClose}
    />
  )
}

interface DocumentPreviewCardProps {
  documentId: string
  documentName: string
  content: string
  metadata?: Record<string, any>
  highlight?: string
  className?: string
}

export function DocumentPreviewCard({ 
  documentId,
  documentName,
  content,
  metadata,
  highlight,
  className = ""
}: DocumentPreviewCardProps) {
  const [showViewer, setShowViewer] = useState(false)
  
  return (
    <>
      <Card className={`p-4 bg-card border-border hover:shadow-md transition-shadow cursor-pointer ${className}`}
            onClick={() => setShowViewer(true)}>
        <div className="flex items-center justify-between mb-2">
          <h4 className="font-medium text-foreground text-sm">{documentName}</h4>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
            <Eye className="w-3 h-3 mr-1" />
            查看
          </Button>
        </div>
        
        <p className="text-sm text-muted-foreground leading-relaxed">
          {content.length > 200 ? `${content.substring(0, 200)}...` : content}
        </p>
        
        {highlight && (
          <div className="mt-2">
            <Badge variant="outline" className="text-xs">
              关键词: {highlight}
            </Badge>
          </div>
        )}
      </Card>
      
      <DocumentViewerModal
        isOpen={showViewer}
        documentId={documentId}
        highlight={highlight}
        onClose={() => setShowViewer(false)}
      />
    </>
  )
}
