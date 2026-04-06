import React, { useState, useRef, useCallback } from 'react';
import { 
  Camera, 
  FileText, 
  Upload, 
  Trash2, 
  Download, 
  Sparkles, 
  X, 
  ChevronRight, 
  ChevronLeft,
  Loader2,
  CheckCircle2,
  Maximize2,
  RotateCw,
  Contrast,
  Sun,
  Edit3,
  MoreVertical,
  Share2,
  Save,
  GripVertical,
  Type,
  Wand2
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { jsPDF } from 'jspdf';
import confetti from 'canvas-confetti';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { GoogleGenAI } from "@google/genai";
import { cn } from './lib/utils';

// --- Types ---
interface ScannedPage {
  id: string;
  dataUrl: string;
  timestamp: number;
  ocrText?: string;
  rotation?: number; // 0, 90, 180, 270
  filter?: 'none' | 'grayscale' | 'contrast' | 'bw' | 'magic';
  note?: string;
}

interface AnalysisResult {
  summary: string;
  keyPoints: string[];
  documentType: string;
  fullText?: string;
}

export default function App() {
  // --- State ---
  const [pages, setPages] = useState<ScannedPage[]>([]);
  const [docName, setDocName] = useState(`Scan_${new Date().toLocaleDateString().replace(/\//g, '-')}`);
  const [isEditingName, setIsEditingName] = useState(false);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isOCRing, setIsOCRing] = useState(false);
  const [isSearchable, setIsSearchable] = useState(true);
  const [isBatchMode, setIsBatchMode] = useState(true);
  const [scanMode, setScanMode] = useState<'document' | 'id_card' | 'business_card' | 'whiteboard'>('document');
  const [viewingIndex, setViewingIndex] = useState<number | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- Image Processing ---
  const processImage = (page: ScannedPage): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = page.dataUrl;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(page.dataUrl);
          return;
        }

        const rotation = page.rotation || 0;
        const filter = page.filter || 'none';

        // Calculate canvas dimensions based on rotation
        if (rotation === 90 || rotation === 270) {
          canvas.width = img.height;
          canvas.height = img.width;
        } else {
          canvas.width = img.width;
          canvas.height = img.height;
        }

        // Apply rotation
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((rotation * Math.PI) / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);

        // Apply filters
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data;

        if (filter === 'grayscale' || filter === 'bw') {
          for (let i = 0; i < data.length; i += 4) {
            const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
            if (filter === 'bw') {
              const val = avg > 128 ? 255 : 0;
              data[i] = data[i + 1] = data[i + 2] = val;
            } else {
              data[i] = data[i + 1] = data[i + 2] = avg;
            }
          }
        } else if (filter === 'contrast') {
          const factor = (259 * (128 + 255)) / (255 * (259 - 128));
          for (let i = 0; i < data.length; i += 4) {
            data[i] = factor * (data[i] - 128) + 128;
            data[i + 1] = factor * (data[i + 1] - 128) + 128;
            data[i + 2] = factor * (data[i + 2] - 128) + 128;
          }
        } else if (filter === 'magic') {
          // Magic color: Boost contrast, saturation, and brightness
          const contrast = 1.2;
          const brightness = 10;
          const saturation = 1.3;
          
          for (let i = 0; i < data.length; i += 4) {
            // Contrast
            data[i] = (data[i] - 128) * contrast + 128 + brightness;
            data[i + 1] = (data[i + 1] - 128) * contrast + 128 + brightness;
            data[i + 2] = (data[i + 2] - 128) * contrast + 128 + brightness;
            
            // Saturation (simplified)
            const gray = 0.2989 * data[i] + 0.5870 * data[i + 1] + 0.1140 * data[i + 2];
            data[i] = gray + saturation * (data[i] - gray);
            data[i + 1] = gray + saturation * (data[i + 1] - gray);
            data[i + 2] = gray + saturation * (data[i + 2] - gray);
          }
        }

        ctx.putImageData(imageData, 0, 0);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
    });
  };

  // --- Camera Logic ---
  const startCamera = async () => {
    try {
      setIsCameraOpen(true);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { facingMode: 'environment' } 
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      alert("Could not access camera. Please check permissions.");
      setIsCameraOpen(false);
    }
  };

  const stopCamera = () => {
    if (videoRef.current && videoRef.current.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
      tracks.forEach(track => track.stop());
    }
    setIsCameraOpen(false);
  };

  const capturePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        addPage(dataUrl);
        // Visual feedback
        confetti({
          particleCount: 20,
          spread: 30,
          origin: { y: 0.9 },
          colors: ['#3b82f6']
        });
        
        if (!isBatchMode) {
          stopCamera();
        }
      }
    }
  };

  // --- Page Management ---
  const addPage = (dataUrl: string) => {
    setPages(prev => [...prev, {
      id: Math.random().toString(36).substr(2, 9),
      dataUrl,
      timestamp: Date.now()
    }]);
  };

  const removePage = (id: string) => {
    setPages(prev => prev.filter(p => p.id !== id));
  };

  const updatePage = (id: string, updates: Partial<ScannedPage>) => {
    setPages(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
  };

  const onDrop = useCallback((acceptedFiles: File[]) => {
    acceptedFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          addPage(reader.result);
        }
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: { 'image/*': [] },
    multiple: true
  } as any);

  // --- OCR Logic ---
  const performOCR = async (pagesToOCR: ScannedPage[]) => {
    setIsOCRing(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = "gemini-3.1-flash-lite-preview";
      
      const updatedPages = [...pages];
      
      for (const page of pagesToOCR) {
        if (page.ocrText) continue; // Skip if already OCR'd

        const response = await ai.models.generateContent({
          model,
          contents: [{
            parts: [
              { inlineData: { data: page.dataUrl.split(',')[1], mimeType: "image/jpeg" } },
              { text: "Extract all text from this image exactly as it appears. Return ONLY the extracted text, no other commentary." }
            ]
          }]
        });

        const text = response.text || "";
        const index = updatedPages.findIndex(p => p.id === page.id);
        if (index !== -1) {
          updatedPages[index] = { ...updatedPages[index], ocrText: text };
        }
      }
      
      setPages(updatedPages);
      return updatedPages;
    } catch (err) {
      console.error("OCR failed:", err);
      return pages;
    } finally {
      setIsOCRing(false);
    }
  };

  // --- Persistence ---
  React.useEffect(() => {
    const saved = localStorage.getItem('smartscan_pages');
    if (saved) {
      try {
        setPages(JSON.parse(saved));
      } catch (e) {
        console.error("Failed to load saved pages", e);
      }
    }
  }, []);

  React.useEffect(() => {
    localStorage.setItem('smartscan_pages', JSON.stringify(pages));
  }, [pages]);

  // --- PDF Generation ---
  const generatePDF = async () => {
    if (pages.length === 0) return;
    setIsGenerating(true);
    
    let currentPages = pages;
    if (isSearchable) {
      currentPages = await performOCR(pages);
    }

    try {
      const pdf = new jsPDF({
        orientation: 'p',
        unit: 'mm',
        format: 'a4'
      });

      for (let i = 0; i < currentPages.length; i++) {
        if (i > 0) pdf.addPage();
        
        const processedDataUrl = await processImage(currentPages[i]);
        const img = new Image();
        img.src = processedDataUrl;
        await new Promise(resolve => img.onload = resolve);

        const pageWidth = pdf.internal.pageSize.getWidth();
        const pageHeight = pdf.internal.pageSize.getHeight();
        const imgWidth = img.width;
        const imgHeight = img.height;
        
        const ratio = Math.min(pageWidth / imgWidth, pageHeight / imgHeight);
        const width = imgWidth * ratio;
        const height = imgHeight * ratio;
        const x = (pageWidth - width) / 2;
        const y = (pageHeight - height) / 2;

        // Add OCR text as a hidden layer if available
        if (currentPages[i].ocrText) {
          pdf.setFontSize(1); // Tiny text
          pdf.setTextColor(255, 255, 255); // White (hidden)
          const lines = pdf.splitTextToSize(currentPages[i].ocrText!, pageWidth - 20);
          pdf.text(lines, 10, 10);
        }

        pdf.addImage(processedDataUrl, 'JPEG', x, y, width, height);
      }

      pdf.save(`${docName || 'scan'}.pdf`);
      confetti({
        particleCount: 100,
        spread: 70,
        origin: { y: 0.6 }
      });
    } catch (err) {
      console.error("PDF generation failed:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  const shareDoc = async () => {
    if (pages.length === 0) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: docName,
          text: `Check out this scanned document: ${docName}`,
          url: window.location.href
        });
      } catch (e) {
        console.error("Sharing failed", e);
      }
    } else {
      alert("Sharing is not supported on this browser.");
    }
  };

  // --- Gemini Analysis ---
  const analyzeWithAI = async () => {
    if (pages.length === 0) return;
    setIsAnalyzing(true);
    setAnalysis(null);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const model = "gemini-3.1-flash-lite-preview";
      
      // We'll analyze the first page as a sample, or all if few
      const parts = pages.slice(0, 3).map(p => ({
        inlineData: {
          data: p.dataUrl.split(',')[1],
          mimeType: "image/jpeg"
        }
      }));

      const modePrompts = {
        document: "Analyze these document pages. Identify the document type (e.g., Receipt, Invoice, Contract, Note), provide a concise summary, and list 3-5 key points or extracted data (like total amount, dates, or main clauses).",
        id_card: "Extract all information from this ID card. Identify the name, ID number, expiry date, and issuing authority.",
        business_card: "Extract contact information from this business card. Identify the name, company, title, email, phone number, and website.",
        whiteboard: "Transcribe the notes from this whiteboard. Summarize the main topics discussed and list any action items identified."
      };

      const prompt = `${modePrompts[scanMode]} Return the response in JSON format with keys: summary (string), keyPoints (array of strings), documentType (string).`;

      const response = await ai.models.generateContent({
        model,
        contents: [{ parts: [...parts, { text: prompt }] }],
        config: { responseMimeType: "application/json" }
      });

      const result = JSON.parse(response.text || "{}");
      setAnalysis(result);
    } catch (err) {
      console.error("AI Analysis failed:", err);
    } finally {
      setIsAnalyzing(false);
    }
  };

  // --- UI Components ---
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-blue-100">
      {/* Header */}
      <header className="sticky top-0 z-30 bg-white/80 backdrop-blur-md border-b border-slate-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2 rounded-xl shadow-lg shadow-blue-200">
            <FileText className="w-6 h-6 text-white" />
          </div>
          <div className="flex flex-col">
            {isEditingName ? (
              <div className="flex items-center gap-2">
                <input 
                  autoFocus
                  type="text" 
                  value={docName}
                  onChange={(e) => setDocName(e.target.value)}
                  onBlur={() => setIsEditingName(false)}
                  onKeyDown={(e) => e.key === 'Enter' && setIsEditingName(false)}
                  className="font-bold text-lg bg-slate-100 px-2 py-0.5 rounded outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button onClick={() => setIsEditingName(false)} className="text-blue-600"><Save className="w-4 h-4" /></button>
              </div>
            ) : (
              <div className="flex items-center gap-2 group cursor-pointer" onClick={() => setIsEditingName(true)}>
                <h1 className="font-bold text-xl tracking-tight">{docName}</h1>
                <Edit3 className="w-4 h-4 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            )}
            <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">AI Document Assistant</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {pages.length > 0 && (
            <>
              <button 
                onClick={shareDoc}
                className="p-2 text-slate-400 hover:text-blue-600 transition-colors"
                title="Share"
              >
                <Share2 className="w-5 h-5" />
              </button>
              <button 
                onClick={() => {
                  if (confirm("Are you sure you want to clear all scans?")) {
                    setPages([]);
                  }
                }}
                className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                title="Clear all"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto p-6 space-y-8">
        {/* Action Bar */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button 
            onClick={startCamera}
            className="group relative overflow-hidden bg-white border-2 border-slate-200 p-8 rounded-3xl flex flex-col items-center gap-4 transition-all hover:border-blue-500 hover:shadow-xl hover:shadow-blue-100 active:scale-95"
          >
            <div className="bg-blue-50 p-4 rounded-2xl group-hover:bg-blue-100 transition-colors">
              <Camera className="w-8 h-8 text-blue-600" />
            </div>
            <div className="text-center">
              <span className="block font-bold text-lg">Scan with Camera</span>
              <span className="text-sm text-slate-500">Capture documents in real-time</span>
            </div>
          </button>

          <div 
            {...getRootProps()} 
            className={cn(
              "group relative overflow-hidden bg-white border-2 border-dashed p-8 rounded-3xl flex flex-col items-center gap-4 transition-all cursor-pointer active:scale-95",
              isDragActive ? "border-blue-500 bg-blue-50" : "border-slate-200 hover:border-blue-400 hover:bg-slate-50"
            )}
          >
            <input {...getInputProps()} />
            <div className="bg-slate-100 p-4 rounded-2xl group-hover:bg-blue-50 transition-colors">
              <Upload className="w-8 h-8 text-slate-600 group-hover:text-blue-600" />
            </div>
            <div className="text-center">
              <span className="block font-bold text-lg">Upload Files</span>
              <span className="text-sm text-slate-500">Drag & drop images here</span>
            </div>
          </div>
        </div>

        {/* Scan Mode Selector */}
        <div className="flex items-center justify-center gap-2 p-1 bg-slate-200/50 rounded-2xl w-fit mx-auto">
          {[
            { id: 'document', label: 'Document' },
            { id: 'id_card', label: 'ID Card' },
            { id: 'business_card', label: 'Business Card' },
            { id: 'whiteboard', label: 'Whiteboard' }
          ].map((mode) => (
            <button
              key={mode.id}
              onClick={() => setScanMode(mode.id as any)}
              className={cn(
                "px-4 py-2 rounded-xl text-xs font-bold transition-all",
                scanMode === mode.id 
                  ? "bg-white text-blue-600 shadow-sm" 
                  : "text-slate-500 hover:text-slate-700"
              )}
            >
              {mode.label}
            </button>
          ))}
        </div>

        {/* Scanned Pages Grid */}
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-bold text-lg flex items-center gap-2">
              Pages <span className="bg-slate-200 text-slate-600 text-xs px-2 py-0.5 rounded-full">{pages.length}</span>
            </h2>
            {pages.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-2 cursor-pointer bg-white border border-slate-200 px-3 py-2 rounded-xl hover:bg-slate-50 transition-colors">
                  <input 
                    type="checkbox" 
                    checked={isSearchable} 
                    onChange={(e) => setIsSearchable(e.target.checked)}
                    className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                  />
                  <span className="text-sm font-bold text-slate-600">Searchable PDF</span>
                </label>
                <button 
                  onClick={analyzeWithAI}
                  disabled={isAnalyzing}
                  className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-xl font-bold text-sm hover:bg-indigo-100 transition-colors disabled:opacity-50"
                >
                  {isAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Smart Analyze
                </button>
                <button 
                  onClick={generatePDF}
                  disabled={isGenerating || isOCRing}
                  className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 disabled:opacity-50 active:scale-95"
                >
                  {isGenerating || isOCRing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {isOCRing ? 'Performing OCR...' : 'Exporting...'}
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" />
                      Export PDF
                    </>
                  )}
                </button>
              </div>
            )}
          </div>

          {pages.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-3xl p-12 flex flex-col items-center justify-center text-slate-400 gap-4">
              <div className="bg-slate-50 p-6 rounded-full">
                <FileText className="w-12 h-12 opacity-20" />
              </div>
              <p className="font-medium">No pages scanned yet</p>
            </div>
          ) : (
            <Reorder.Group 
              axis="y" 
              values={pages} 
              onReorder={setPages}
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4"
            >
              <AnimatePresence mode="popLayout">
                {pages.map((page, index) => (
                  <Reorder.Item 
                    key={page.id}
                    value={page}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    className="group relative aspect-[3/4] bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-all cursor-grab active:cursor-grabbing"
                  >
                    <img 
                      src={page.dataUrl} 
                      alt={`Page ${index + 1}`} 
                      className={cn(
                        "w-full h-full object-cover transition-all",
                        page.filter === 'grayscale' && "grayscale",
                        page.filter === 'contrast' && "contrast-150",
                        page.filter === 'bw' && "grayscale brightness-150 contrast-200",
                        page.filter === 'magic' && "saturate-150 contrast-125 brightness-110"
                      )}
                      style={{ transform: `rotate(${page.rotation || 0}deg)` }}
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                      <button 
                        onClick={() => setViewingIndex(index)}
                        className="p-2 bg-white/20 backdrop-blur-md rounded-full text-white hover:bg-white/40 transition-colors"
                      >
                        <Maximize2 className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => setEditingIndex(index)}
                        className="p-2 bg-white/20 backdrop-blur-md rounded-full text-white hover:bg-white/40 transition-colors"
                      >
                        <Edit3 className="w-5 h-5" />
                      </button>
                      <button 
                        onClick={() => removePage(page.id)}
                        className="p-2 bg-red-500/80 backdrop-blur-md rounded-full text-white hover:bg-red-600 transition-colors"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                    <div className="absolute top-2 left-2 p-1 bg-black/20 backdrop-blur-md rounded-md text-white opacity-0 group-hover:opacity-100 transition-opacity">
                      <GripVertical className="w-4 h-4" />
                    </div>
                    <div className="absolute bottom-2 left-2 bg-black/50 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                      Page {index + 1}
                    </div>
                  </Reorder.Item>
                ))}
              </AnimatePresence>
            </Reorder.Group>
          )}
        </section>

        {/* AI Analysis Result */}
        <AnimatePresence>
          {analysis && (
            <motion.section 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="bg-indigo-600 rounded-3xl p-8 text-white shadow-2xl shadow-indigo-200 overflow-hidden relative"
            >
              <div className="absolute top-0 right-0 p-8 opacity-10">
                <Sparkles className="w-32 h-32" />
              </div>
              
              <div className="relative z-10 space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-5 h-5" />
                    <h3 className="font-bold text-xl">AI Insights</h3>
                  </div>
                  <span className="bg-white/20 backdrop-blur-md px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest">
                    {analysis.documentType}
                  </span>
                </div>

                <div className="space-y-4">
                  <div>
                    <h4 className="text-indigo-200 text-sm font-bold uppercase tracking-wider mb-1">Summary</h4>
                    <p className="text-lg leading-relaxed font-medium">{analysis.summary}</p>
                  </div>

                  <div>
                    <h4 className="text-indigo-200 text-sm font-bold uppercase tracking-wider mb-2">Key Points</h4>
                    <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {analysis.keyPoints.map((point, i) => (
                        <li key={i} className="flex items-start gap-3 bg-white/10 p-3 rounded-xl border border-white/10">
                          <CheckCircle2 className="w-5 h-5 text-indigo-300 shrink-0" />
                          <span className="text-sm font-medium">{point}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* Camera Overlay */}
      <AnimatePresence>
        {isCameraOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black flex flex-col"
          >
            <div className="absolute top-0 left-0 right-0 p-6 flex justify-between items-center z-10">
              <button 
                onClick={stopCamera}
                className="p-3 bg-white/10 backdrop-blur-xl rounded-full text-white hover:bg-white/20"
              >
                <X className="w-6 h-6" />
              </button>
              
              <div className="flex items-center gap-4">
                <button 
                  onClick={() => setIsBatchMode(!isBatchMode)}
                  className={cn(
                    "px-4 py-2 rounded-full text-xs font-bold transition-all",
                    isBatchMode ? "bg-blue-600 text-white" : "bg-white/10 text-white/60"
                  )}
                >
                  {isBatchMode ? 'Batch Mode: ON' : 'Single Mode'}
                </button>
                <div className="bg-white/10 backdrop-blur-xl px-4 py-2 rounded-full text-white text-sm font-bold">
                  {pages.length} Pages Scanned
                </div>
              </div>
            </div>

            <div className="flex-1 relative overflow-hidden">
              <video 
                ref={videoRef} 
                autoPlay 
                playsInline 
                className="w-full h-full object-cover"
              />
              {/* Scan Guide Overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-[80%] aspect-[3/4] border-2 border-white/30 rounded-2xl relative">
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-blue-500 rounded-tl-xl" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-blue-500 rounded-tr-xl" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-blue-500 rounded-bl-xl" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-blue-500 rounded-br-xl" />
                </div>
              </div>
            </div>

            <div className="bg-black p-8 flex items-center justify-center gap-12">
              <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-white/20 bg-slate-800">
                {pages.length > 0 && (
                  <img src={pages[pages.length-1].dataUrl} className="w-full h-full object-cover" />
                )}
              </div>
              
              <button 
                onClick={capturePhoto}
                className="w-20 h-20 bg-white rounded-full p-1 border-4 border-white/20 hover:scale-110 active:scale-95 transition-all"
              >
                <div className="w-full h-full bg-white rounded-full border-2 border-black/10 shadow-inner flex items-center justify-center">
                  <div className="w-16 h-16 rounded-full border-2 border-slate-200" />
                </div>
              </button>

              <button 
                onClick={stopCamera}
                className="flex flex-col items-center gap-1 text-white/60 hover:text-white transition-colors"
              >
                <div className="bg-white/10 p-3 rounded-full">
                  <ChevronRight className="w-6 h-6" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest">Done</span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Preview Modal */}
      <AnimatePresence>
        {viewingIndex !== null && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <button 
              onClick={() => setViewingIndex(null)}
              className="absolute top-6 right-6 p-3 bg-white/10 rounded-full text-white hover:bg-white/20 transition-colors"
            >
              <X className="w-6 h-6" />
            </button>

            <div className="relative max-w-2xl w-full aspect-[3/4] bg-white rounded-2xl overflow-hidden shadow-2xl">
              <img 
                src={pages[viewingIndex].dataUrl} 
                className={cn(
                  "w-full h-full object-contain bg-slate-100 transition-all",
                  pages[viewingIndex].filter === 'grayscale' && "grayscale",
                  pages[viewingIndex].filter === 'contrast' && "contrast-150",
                  pages[viewingIndex].filter === 'bw' && "grayscale brightness-150 contrast-200",
                  pages[viewingIndex].filter === 'magic' && "saturate-150 contrast-125 brightness-110"
                )}
                style={{ transform: `rotate(${pages[viewingIndex].rotation || 0}deg)` }}
              />
              
              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-4">
                <button 
                  disabled={viewingIndex === 0}
                  onClick={() => setViewingIndex(prev => prev! - 1)}
                  className="p-3 bg-black/50 backdrop-blur-md rounded-full text-white disabled:opacity-20"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                
                <div className="flex flex-col items-center gap-2">
                  <span className="bg-black/50 backdrop-blur-md px-4 py-2 rounded-full text-white font-bold text-sm">
                    {viewingIndex + 1} / {pages.length}
                  </span>
                  <div className="flex gap-2">
                    <button 
                      onClick={async () => {
                        const processed = await processImage(pages[viewingIndex!]);
                        const link = document.createElement('a');
                        link.href = processed;
                        link.download = `page_${viewingIndex! + 1}.jpg`;
                        link.click();
                      }}
                      className="p-2 bg-black/50 backdrop-blur-md rounded-lg text-white hover:bg-black/70 transition-colors"
                      title="Download Image"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    {pages[viewingIndex!].ocrText && (
                      <button 
                        onClick={() => {
                          navigator.clipboard.writeText(pages[viewingIndex!].ocrText!);
                          alert("Text copied to clipboard!");
                        }}
                        className="p-2 bg-black/50 backdrop-blur-md rounded-lg text-white hover:bg-black/70 transition-colors"
                        title="Copy Text"
                      >
                        <FileText className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <button 
                  disabled={viewingIndex === pages.length - 1}
                  onClick={() => setViewingIndex(prev => prev! + 1)}
                  className="p-3 bg-black/50 backdrop-blur-md rounded-full text-white disabled:opacity-20"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {editingIndex !== null && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 backdrop-blur-xl flex items-center justify-center p-6"
          >
            <div className="bg-white rounded-3xl max-w-4xl w-full overflow-hidden shadow-2xl flex flex-col md:flex-row h-[80vh]">
              {/* Image Preview */}
              <div className="flex-1 bg-slate-100 flex items-center justify-center p-8 overflow-hidden relative">
                <img 
                  src={pages[editingIndex].dataUrl} 
                  className={cn(
                    "max-w-full max-h-full object-contain transition-all shadow-xl",
                    pages[editingIndex].filter === 'grayscale' && "grayscale",
                    pages[editingIndex].filter === 'contrast' && "contrast-150",
                    pages[editingIndex].filter === 'bw' && "grayscale brightness-150 contrast-200",
                    pages[editingIndex].filter === 'magic' && "saturate-150 contrast-125 brightness-110"
                  )}
                  style={{ transform: `rotate(${pages[editingIndex].rotation || 0}deg)` }}
                />
              </div>

              {/* Controls */}
              <div className="w-full md:w-80 bg-white border-l border-slate-200 p-6 flex flex-col gap-8">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-xl">Edit Page</h3>
                  <button 
                    onClick={() => setEditingIndex(null)}
                    className="p-2 hover:bg-slate-100 rounded-full transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Rotation</label>
                    <button 
                      onClick={() => {
                        const current = pages[editingIndex].rotation || 0;
                        updatePage(pages[editingIndex].id, { rotation: (current + 90) % 360 });
                      }}
                      className="w-full flex items-center justify-center gap-2 bg-slate-100 hover:bg-slate-200 p-3 rounded-xl font-bold transition-colors"
                    >
                      <RotateCw className="w-5 h-5" />
                      Rotate 90°
                    </button>
                  </div>

                  <div className="space-y-3">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Filters</label>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'none', label: 'None', icon: Sun },
                        { id: 'magic', label: 'Magic', icon: Wand2 },
                        { id: 'grayscale', label: 'Grayscale', icon: Contrast },
                        { id: 'contrast', label: 'Contrast', icon: Sun },
                        { id: 'bw', label: 'B&W', icon: Contrast }
                      ].map((f) => (
                        <button 
                          key={f.id}
                          onClick={() => updatePage(pages[editingIndex].id, { filter: f.id as any })}
                          className={cn(
                            "flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all",
                            pages[editingIndex].filter === f.id || (!pages[editingIndex].filter && f.id === 'none')
                              ? "border-blue-600 bg-blue-50 text-blue-600"
                              : "border-slate-100 hover:border-slate-200 text-slate-600"
                          )}
                        >
                          <f.icon className="w-5 h-5" />
                          <span className="text-[10px] font-bold">{f.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-3">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Notes</label>
                    <textarea 
                      value={pages[editingIndex].note || ''}
                      onChange={(e) => updatePage(pages[editingIndex].id, { note: e.target.value })}
                      placeholder="Add a note to this page..."
                      className="w-full h-24 bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />
                  </div>
                </div>

                <div className="mt-auto pt-6 border-t border-slate-100">
                  <button 
                    onClick={() => setEditingIndex(null)}
                    className="w-full bg-blue-600 text-white p-4 rounded-2xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-100 active:scale-95"
                  >
                    Done Editing
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Hidden Canvas for Capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
