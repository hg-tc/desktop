"use client";

import React, { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  FileText, 
  Download, 
  Settings, 
  Wand2, 
  CheckCircle, 
  AlertCircle,
  Loader2,
  File,
  Image,
  Table,
  Calendar,
  User
} from 'lucide-react';

interface DocumentTemplate {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  fields: DocumentField[];
  category: string;
}

interface DocumentField {
  id: string;
  name: string;
  type: 'text' | 'textarea' | 'select' | 'date' | 'number';
  required: boolean;
  placeholder?: string;
  options?: string[];
  description?: string;
}

interface GenerationSettings {
  format: 'docx' | 'pdf';
  template: string;
  includeImages: boolean;
  includeTables: boolean;
  quality: 'draft' | 'standard' | 'premium';
  language: 'zh' | 'en';
}

interface GenerationProgress {
  stage: string;
  progress: number;
  message: string;
}

const documentTemplates: DocumentTemplate[] = [
  {
    id: 'report',
    name: '分析报告',
    description: '生成数据分析报告',
    icon: <FileText className="h-4 w-4" />,
    category: 'business',
    fields: [
      { id: 'title', name: '报告标题', type: 'text', required: true, placeholder: '请输入报告标题' },
      { id: 'summary', name: '执行摘要', type: 'textarea', required: true, placeholder: '请输入执行摘要' },
      { id: 'analysis', name: '分析内容', type: 'textarea', required: true, placeholder: '请输入详细分析内容' },
      { id: 'conclusions', name: '结论建议', type: 'textarea', required: true, placeholder: '请输入结论和建议' },
      { id: 'author', name: '报告作者', type: 'text', required: false, placeholder: '请输入作者姓名' },
      { id: 'date', name: '报告日期', type: 'date', required: false }
    ]
  },
  {
    id: 'proposal',
    name: '项目提案',
    description: '生成项目提案文档',
    icon: <File className="h-4 w-4" />,
    category: 'business',
    fields: [
      { id: 'project_name', name: '项目名称', type: 'text', required: true, placeholder: '请输入项目名称' },
      { id: 'objective', name: '项目目标', type: 'textarea', required: true, placeholder: '请输入项目目标' },
      { id: 'scope', name: '项目范围', type: 'textarea', required: true, placeholder: '请输入项目范围' },
      { id: 'timeline', name: '时间安排', type: 'textarea', required: true, placeholder: '请输入时间安排' },
      { id: 'budget', name: '预算估算', type: 'number', required: false, placeholder: '请输入预算金额' },
      { id: 'team', name: '团队信息', type: 'textarea', required: false, placeholder: '请输入团队信息' }
    ]
  },
  {
    id: 'meeting_minutes',
    name: '会议纪要',
    description: '生成会议纪要文档',
    icon: <Calendar className="h-4 w-4" />,
    category: 'meeting',
    fields: [
      { id: 'meeting_title', name: '会议主题', type: 'text', required: true, placeholder: '请输入会议主题' },
      { id: 'date', name: '会议日期', type: 'date', required: true },
      { id: 'attendees', name: '参会人员', type: 'textarea', required: true, placeholder: '请输入参会人员名单' },
      { id: 'agenda', name: '会议议程', type: 'textarea', required: true, placeholder: '请输入会议议程' },
      { id: 'discussions', name: '讨论内容', type: 'textarea', required: true, placeholder: '请输入讨论内容' },
      { id: 'decisions', name: '决议事项', type: 'textarea', required: true, placeholder: '请输入决议事项' },
      { id: 'action_items', name: '行动项', type: 'textarea', required: false, placeholder: '请输入行动项' }
    ]
  },
  {
    id: 'data_summary',
    name: '数据汇总',
    description: '生成数据汇总报告',
    icon: <Table className="h-4 w-4" />,
    category: 'data',
    fields: [
      { id: 'dataset_name', name: '数据集名称', type: 'text', required: true, placeholder: '请输入数据集名称' },
      { id: 'data_source', name: '数据来源', type: 'text', required: true, placeholder: '请输入数据来源' },
      { id: 'summary_stats', name: '统计摘要', type: 'textarea', required: true, placeholder: '请输入统计摘要' },
      { id: 'key_findings', name: '关键发现', type: 'textarea', required: true, placeholder: '请输入关键发现' },
      { id: 'visualizations', name: '可视化说明', type: 'textarea', required: false, placeholder: '请输入可视化说明' },
      { id: 'recommendations', name: '建议', type: 'textarea', required: false, placeholder: '请输入建议' }
    ]
  }
];

export default function DocumentGenerator() {
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate | null>(null);
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<GenerationSettings>({
    format: 'docx',
    template: '',
    includeImages: true,
    includeTables: true,
    quality: 'standard',
    language: 'zh'
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<GenerationProgress | null>(null);
  const [generatedFiles, setGeneratedFiles] = useState<Array<{name: string, url: string, type: string}>>([]);
  const [error, setError] = useState<string | null>(null);

  const handleTemplateSelect = useCallback((template: DocumentTemplate) => {
    setSelectedTemplate(template);
    setSettings(prev => ({ ...prev, template: template.id }));
    
    // 初始化表单数据
    const initialData: Record<string, string> = {};
    template.fields.forEach(field => {
      initialData[field.id] = '';
    });
    setFormData(initialData);
    setError(null);
  }, []);

  const handleFieldChange = useCallback((fieldId: string, value: string) => {
    setFormData(prev => ({ ...prev, [fieldId]: value }));
  }, []);

  const handleSettingsChange = useCallback((key: keyof GenerationSettings, value: any) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const validateForm = useCallback(() => {
    if (!selectedTemplate) return false;
    
    for (const field of selectedTemplate.fields) {
      if (field.required && !formData[field.id]?.trim()) {
        setError(`请填写必填字段: ${field.name}`);
        return false;
      }
    }
    
    return true;
  }, [selectedTemplate, formData]);

  const handleGenerate = useCallback(async () => {
    if (!validateForm()) return;
    
    setIsGenerating(true);
    setError(null);
    setProgress({ stage: 'preparing', progress: 0, message: '准备生成文档...' });
    
    try {
      // 模拟生成过程
      const stages = [
        { stage: 'preparing', progress: 20, message: '准备文档模板...' },
        { stage: 'processing', progress: 40, message: '处理文档内容...' },
        { stage: 'formatting', progress: 60, message: '格式化文档...' },
        { stage: 'generating', progress: 80, message: '生成最终文档...' },
        { stage: 'complete', progress: 100, message: '文档生成完成!' }
      ];
      
      for (const stage of stages) {
        setProgress(stage);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // 模拟生成的文件
      const generatedFile = {
        name: `${selectedTemplate?.name}_${new Date().toISOString().split('T')[0]}.${settings.format}`,
        url: '#',
        type: settings.format
      };
      
      setGeneratedFiles(prev => [...prev, generatedFile]);
      
    } catch (err) {
      setError('文档生成失败，请重试');
    } finally {
      setIsGenerating(false);
      setProgress(null);
    }
  }, [selectedTemplate, formData, settings, validateForm]);

  const handleDownload = useCallback((file: {name: string, url: string, type: string}) => {
    // 实际实现中，这里会触发文件下载
    console.log('下载文件:', file);
  }, []);

  const renderField = useCallback((field: DocumentField) => {
    const value = formData[field.id] || '';
    
    switch (field.type) {
      case 'textarea':
        return (
          <Textarea
            id={field.id}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            placeholder={field.placeholder}
            className="min-h-[100px]"
          />
        );
      case 'select':
        return (
          <Select value={value} onValueChange={(val) => handleFieldChange(field.id, val)}>
            <SelectTrigger>
              <SelectValue placeholder={field.placeholder} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map(option => (
                <SelectItem key={option} value={option}>{option}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'date':
        return (
          <Input
            id={field.id}
            type="date"
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
          />
        );
      case 'number':
        return (
          <Input
            id={field.id}
            type="number"
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            placeholder={field.placeholder}
          />
        );
      default:
        return (
          <Input
            id={field.id}
            value={value}
            onChange={(e) => handleFieldChange(field.id, e.target.value)}
            placeholder={field.placeholder}
          />
        );
    }
  }, [formData, handleFieldChange]);

  return (
    <div className="container mx-auto p-6 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">智能文档生成器</h1>
        <p className="text-muted-foreground">
          使用AI技术快速生成专业文档，支持多种模板和格式
        </p>
      </div>

      <Tabs defaultValue="templates" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="templates">选择模板</TabsTrigger>
          <TabsTrigger value="content">填写内容</TabsTrigger>
          <TabsTrigger value="settings">生成设置</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {documentTemplates.map(template => (
              <Card 
                key={template.id} 
                className={`cursor-pointer transition-all hover:shadow-md ${
                  selectedTemplate?.id === template.id ? 'ring-2 ring-primary' : ''
                }`}
                onClick={() => handleTemplateSelect(template)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-center space-x-2">
                    {template.icon}
                    <CardTitle className="text-lg">{template.name}</CardTitle>
                  </div>
                  <CardDescription>{template.description}</CardDescription>
                </CardHeader>
                <CardContent>
                  <Badge variant="secondary">{template.category}</Badge>
                  <p className="text-sm text-muted-foreground mt-2">
                    {template.fields.length} 个字段
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="content" className="space-y-4">
          {selectedTemplate ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center space-x-2">
                  {selectedTemplate.icon}
                  <span>{selectedTemplate.name}</span>
                </CardTitle>
                <CardDescription>{selectedTemplate.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {selectedTemplate.fields.map(field => (
                  <div key={field.id} className="space-y-2">
                    <label htmlFor={field.id} className="text-sm font-medium">
                      {field.name}
                      {field.required && <span className="text-red-500 ml-1">*</span>}
                    </label>
                    {renderField(field)}
                    {field.description && (
                      <p className="text-xs text-muted-foreground">{field.description}</p>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                请先选择一个文档模板
              </AlertDescription>
            </Alert>
          )}
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Settings className="h-4 w-4" />
                <span>生成设置</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">输出格式</label>
                  <Select 
                    value={settings.format} 
                    onValueChange={(value: 'docx' | 'pdf') => handleSettingsChange('format', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="docx">Word文档 (.docx)</SelectItem>
                      <SelectItem value="pdf">PDF文档 (.pdf)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">文档质量</label>
                  <Select 
                    value={settings.quality} 
                    onValueChange={(value: 'draft' | 'standard' | 'premium') => handleSettingsChange('quality', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="draft">草稿版</SelectItem>
                      <SelectItem value="standard">标准版</SelectItem>
                      <SelectItem value="premium">精装版</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">语言</label>
                  <Select 
                    value={settings.language} 
                    onValueChange={(value: 'zh' | 'en') => handleSettingsChange('language', value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="zh">中文</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="includeImages"
                    checked={settings.includeImages}
                    onChange={(e) => handleSettingsChange('includeImages', e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="includeImages" className="text-sm font-medium">
                    包含图片和图表
                  </label>
                </div>

                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="includeTables"
                    checked={settings.includeTables}
                    onChange={(e) => handleSettingsChange('includeTables', e.target.checked)}
                    className="rounded"
                  />
                  <label htmlFor="includeTables" className="text-sm font-medium">
                    包含表格数据
                  </label>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* 生成按钮和进度 */}
      <div className="mt-6 space-y-4">
        <div className="flex justify-center">
          <Button 
            onClick={handleGenerate}
            disabled={!selectedTemplate || isGenerating}
            size="lg"
            className="min-w-[200px]"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Wand2 className="mr-2 h-4 w-4" />
                生成文档
              </>
            )}
          </Button>
        </div>

        {progress && (
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span>{progress.message}</span>
                  <span>{progress.progress}%</span>
                </div>
                <Progress value={progress.progress} className="w-full" />
              </div>
            </CardContent>
          </Card>
        )}

        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* 生成的文件列表 */}
        {generatedFiles.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <CheckCircle className="h-4 w-4 text-green-500" />
                <span>已生成文档</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {generatedFiles.map((file, index) => (
                  <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center space-x-2">
                      <File className="h-4 w-4" />
                      <span className="font-medium">{file.name}</span>
                      <Badge variant="outline">{file.type.toUpperCase()}</Badge>
                    </div>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => handleDownload(file)}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      下载
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
