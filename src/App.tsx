import React, { useState, useCallback } from 'react';
import { Upload, FileText, CheckCircle, Download, Loader2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GoogleGenAI } from "@google/genai";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Initialize Gemini API
// process.env.GEMINI_API_KEY is injected by Vite config
const ai = new GoogleGenAI({ apiKey: (process.env.GEMINI_API_KEY || "") });

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [progressMsg, setProgressMsg] = useState<string>("");

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile && droppedFile.type === 'application/pdf') {
      setFile(droppedFile);
      setError(null);
    } else {
      setError("Veuillez déposer un fichier PDF valide.");
    }
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
    }
  };

  const handleReformatting = async () => {
    if (!file) return;

    setStatus('processing');
    setError(null);
    
    try {
      // 1. Extract text from PDF via server
      setProgressMsg("Extraction du texte du PDF...");
      const formData = new FormData();
      formData.append('file', file);

      const extractResponse = await fetch('/api/extract-text', {
        method: 'POST',
        body: formData,
      });

      if (!extractResponse.ok) {
        const errData = await extractResponse.json();
        throw new Error(errData.error || "Erreur lors de l'extraction du texte.");
      }

      const { text: rawText } = await extractResponse.json();

      // 2. AI Analysis via GoogleGenAI in browser - CHUNKED PROCESSING
      setProgressMsg("Analyse par l'IA (Traitement intégral en cours)...");
      
      const CHUNK_SIZE = 15000; // Optimal size for verbatim response
      const textChunks = [];
      for (let i = 0; i < rawText.length; i += CHUNK_SIZE) {
        textChunks.push(rawText.slice(i, i + CHUNK_SIZE));
      }

      const fullStructuredSections = [];
      let courseTitle = "";
      let courseMatter = "";
      let courseKeyTerms: string[] = [];

      for (let i = 0; i < textChunks.length; i++) {
        setProgressMsg(`Traitement de la partie ${i + 1} sur ${textChunks.length}...`);
        
        const chunkPrompt = `
          Tu es un assistant expert en structuration de cours médicaux.
          TON OBJECTIF : Convertir ce texte brut en JSON sans perdre AUCUN MOT.
          
          PARTIE DU TEXTE (${i + 1}/${textChunks.length}) :
          """
          ${textChunks[i]}
          """
          
          Format JSON attendu :
          {
            "title": "Titre (nécessaire pour la partie 1)",
            "matter": "Matière (nécessaire pour la partie 1)",
            "sections": [
              {
                "level": 1,
                "title": "Titre de section",
                "content": [
                  { "type": "paragraph", "text": "Texte intégral..." },
                  { "type": "list", "items": ["Item intégral..."] },
                  { "type": "important", "text": "Note intégrale..." }
                ]
              }
            ],
            "keyTerms": ["terme1", "terme2"]
          }
          
          RÈGLES D'OR :
          1. COPIE MOT POUR MOT. Ne résume pas. Ne change pas le style.
          2. Si une phrase commence dans cette partie, finis-la.
          3. Pour les parties après la n°1, laisse "title" et "matter" vides ou réutilise-les.
          4. Réponds UNIQUEMENT avec le JSON.
        `;

        const aiResponse = await ai.models.generateContent({
          model: "gemini-3-flash-preview", 
          contents: [{ role: "user", parts: [{ text: chunkPrompt }] }],
        });

        const responseText = aiResponse.text;
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const partJson = JSON.parse(jsonMatch[0]);
          if (i === 0) {
            courseTitle = partJson.title || "Cours sans titre";
            courseMatter = partJson.matter || "Médecine";
          }
          if (partJson.sections) {
            fullStructuredSections.push(...partJson.sections);
          }
          if (partJson.keyTerms) {
            courseKeyTerms = [...new Set([...courseKeyTerms, ...partJson.keyTerms])];
          }
        }
      }

      const structuredCourse = {
        title: courseTitle,
        matter: courseMatter,
        objectives: [],
        sections: fullStructuredSections,
        keyTerms: courseKeyTerms
      };

      // 3. Generate DOCX via server
      setProgressMsg("Finalisation du document Word...");
      const docxResponse = await fetch('/api/generate-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(structuredCourse),
      });

      if (!docxResponse.ok) throw new Error("Erreur lors de la génération du document.");

      const blob = await docxResponse.blob();
      const url = window.URL.createObjectURL(blob);
      setDownloadUrl(url);
      setStatus('success');
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Une erreur est survenue lors du traitement.");
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-[#1E293B]">
      {/* Navbar */}
      <nav className="fixed top-0 w-full bg-white/10 backdrop-blur-md border-b border-white/20 z-50">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-[#1F3864] rounded-lg flex items-center justify-center text-white shadow-lg shadow-blue-900/20">
              <FileText size={24} />
            </div>
            <span className="text-xl font-bold tracking-tight text-[#1F3864]">Residanat Formatter</span>
          </div>
          <div className="text-sm font-medium text-slate-500 hidden sm:block">
            Standard TCEM/EE - Algérie
          </div>
        </div>
      </nav>

      <main className="pt-32 pb-20 px-6 max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl sm:text-5xl font-extrabold text-[#1F3864] mb-4 tracking-tight"
          >
            Donnez une seconde vie à vos cours
          </motion.h1>
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-lg text-slate-600 max-w-2xl mx-auto leading-relaxed"
          >
            Transformez vos PDF de cours bruts en documents Word (.docx) parfaitement structurés, 
            lisibles et enrichis pour une étude optimale du résidanat.
          </motion.p>
        </div>

        <div className="bg-white rounded-[2rem] shadow-2xl shadow-slate-200/60 p-8 border border-white overflow-hidden relative">
          <AnimatePresence mode="wait">
            {status === 'idle' || status === 'error' ? (
              <motion.div
                key="dropzone"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-6"
              >
                <div 
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={onDrop}
                  className={cn(
                    "relative group cursor-pointer border-2 border-dashed rounded-[1.5rem] transition-all duration-300 py-16 flex flex-col items-center justify-center gap-4",
                    file ? "border-[#2E75B6] bg-blue-50/40" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50/50"
                  )}
                  onClick={() => document.getElementById('fileInput')?.click()}
                >
                  <input 
                    type="file" 
                    id="fileInput" 
                    className="hidden" 
                    accept=".pdf"
                    onChange={handleFileChange}
                  />
                  <div className="w-20 h-20 bg-blue-100 text-[#2E75B6] rounded-full flex items-center justify-center group-hover:scale-110 transition-transform duration-300">
                    <Upload size={36} />
                  </div>
                  <div className="text-center px-4">
                    <p className="text-xl font-bold text-[#1F3864]">
                      {file ? file.name : "Cliquez ou déposez votre PDF ici"}
                    </p>
                    <p className="text-sm text-slate-500 mt-2">
                      Fichiers PDF uniquement • Limite de 20MB
                    </p>
                  </div>
                </div>

                {error && (
                  <motion.div 
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="bg-red-50 text-red-600 px-5 py-4 rounded-2xl flex items-center gap-3 border border-red-100"
                  >
                    <AlertCircle size={20} className="shrink-0" />
                    <span className="text-sm font-semibold">{error}</span>
                  </motion.div>
                )}

                <button
                  disabled={!file}
                  onClick={handleReformatting}
                  className={cn(
                    "w-full py-5 rounded-2xl font-bold text-xl transition-all shadow-xl active:scale-[0.98] select-none",
                    file 
                      ? "bg-[#1F3864] text-white shadow-[#1F3864]/20 hover:bg-[#162a4a] hover:-translate-y-1" 
                      : "bg-slate-100 text-slate-400 cursor-not-allowed shadow-none"
                  )}
                >
                  Lancer le reformatage intelligent
                </button>
              </motion.div>
            ) : status === 'processing' ? (
              <motion.div
                key="processing"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="py-24 flex flex-col items-center gap-8"
              >
                <div className="relative">
                  <motion.div 
                    animate={{ scale: [1, 1.1, 1], rotate: 360 }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                    className="w-24 h-24 border-4 border-[#2E75B6]/20 border-t-[#2E75B6] rounded-full"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <FileText size={32} className="text-[#1F3864]" />
                  </div>
                </div>
                <div className="text-center space-y-3">
                  <h3 className="text-2xl font-bold text-[#1F3864]">{progressMsg}</h3>
                  <p className="text-slate-500 max-w-xs mx-auto animate-pulse">
                    L'IA structure et enrichit votre cours selon les standards TCEM...
                  </p>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="py-20 flex flex-col items-center gap-10"
              >
                <div className="w-24 h-24 bg-green-100 text-green-600 rounded-full flex items-center justify-center shadow-inner">
                  <CheckCircle size={56} />
                </div>
                <div className="text-center space-y-3">
                  <h3 className="text-3xl font-extrabold text-[#1F3864]">C'est prêt !</h3>
                  <p className="text-lg text-slate-500">Le document Word a été généré avec succès.</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-4 w-full">
                  <a
                    href={downloadUrl!}
                    download="cours_reformate.docx"
                    className="flex-1 bg-[#2E75B6] text-white py-5 rounded-2xl font-bold text-center flex items-center justify-center gap-3 hover:bg-[#1c5d94] transition-all shadow-xl shadow-blue-200 hover:-translate-y-1"
                  >
                    <Download size={24} />
                    Télécharger le .docx
                  </a>
                  <button
                    onClick={() => { setFile(null); setStatus('idle'); setDownloadUrl(null); }}
                    className="px-10 bg-slate-100 text-[#1F3864] py-5 rounded-2xl font-bold hover:bg-slate-200 transition-all active:scale-95"
                  >
                    Recommencer
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-24">
          {[
            { 
              title: "Hiérarchie Médicale", 
              desc: "Détection automatique des chapitres, sections et sous-sections cliniques.",
              icon: <FileText className="text-[#2E75B6]" size={20} />
            },
            { 
              title: "Enrichissement Sémantique", 
              desc: "Mise en valeur intelligente des termes sémiologiques et thérapeutiques.",
              icon: <CheckCircle className="text-[#2E75B6]" size={20} />
            },
            { 
              title: "Édition Facile", 
              desc: "Compatible Word, Google Docs et LibreOffice pour vos annotations finales.",
              icon: <Download className="text-[#2E75B6]" size={20} />
            }
          ].map((feature, i) => (
            <motion.div 
              key={i} 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 + (i * 0.1) }}
              className="p-8 bg-white rounded-3xl border border-slate-100 shadow-sm hover:shadow-md transition-shadow group"
            >
              <div className="w-10 h-10 bg-slate-50 rounded-xl flex items-center justify-center mb-4 group-hover:bg-blue-50 transition-colors">
                {feature.icon}
              </div>
              <h4 className="font-bold text-[#1F3864] mb-3 text-lg">{feature.title}</h4>
              <p className="text-sm text-slate-600 leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </div>
      </main>
      
      <footer className="py-16 border-t border-slate-200/60 bg-white/50 text-center">
        <p className="text-slate-400 text-sm font-medium tracking-wide">
          CONÇU POUR L'EXCELLENCE MÉDICALE — TCEM / EE ALGÉRIE
        </p>
      </footer>
    </div>
  );
}

