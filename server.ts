import express from "express";
import "dotenv/config";
import { createServer as createViteServer } from "vite";
import path from "path";
import fileUpload from "express-fileupload";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
let pdf: any;
try {
  pdf = require("pdf-parse");
} catch (e) {
  console.error("Initial pdf-parse load failed:", e);
}

import { 
  Document, 
  Packer, 
  Paragraph, 
  TextRun, 
  HeadingLevel, 
  AlignmentType, 
  BorderStyle, 
  ShadingType,
  TableOfContents,
  Header,
  Footer,
  PageNumber,
  NumberFormat,
  ImageRun
} from "docx";

// --- COLORS ---
const COLORS = {
  primary:       "1F3864",  // Bleu marine
  secondary:     "2E75B6",  // Bleu moyen
  accent:        "D6E4F0",  // Bleu pâle
  altRow:        "EBF3FB",  // Bleu très pâle
  warning:       "FFF3E0",  // Orange pâle
  warningBorder: "E67E22",  // Orange
  keyterm:       "1A5276",  // Bleu foncé
  danger:        "C0392B",  // Rouge
  border:        "ADB9CA",  // Gris bleu
  gray:          "64748B",  // Gris moyen
  caption:       "666666",  // Gris
  text:          "1A1A1A",  // Quasi-noir
};

// --- HELPERS ---
function createRichParagraph(segments: any[]) {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: 276, after: 120 },
    children: segments.map((s: any) => new TextRun({
      font: "Arial",
      size: 22,
      text: s.text,
      bold: s.bold || false,
      color: s.color || COLORS.text,
      italics: s.italics || false,
    })),
  });
}

function enrichText(text: string, keyTerms: string[]) {
  let segments = [{ text: text, bold: false, color: COLORS.text }];
  
  for (const term of keyTerms) {
    const newSegments: any[] = [];
    segments.forEach(seg => {
      if (seg.bold) {
        newSegments.push(seg);
        return;
      }
      
      const parts = seg.text.split(new RegExp(`(${term})`, 'gi'));
      parts.forEach(part => {
        if (part.toLowerCase() === term.toLowerCase()) {
          newSegments.push({ text: part, bold: true, color: COLORS.keyterm });
        } else if (part !== "") {
          newSegments.push({ text: part, bold: false, color: COLORS.text });
        }
      });
    });
    segments = newSegments;
  }
  return segments;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(fileUpload({
    limits: { fileSize: 50 * 1024 * 1024 },
    abortOnLimit: true
  }));

  // Request logger
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  const PORT = 3000;

  // Health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", pdfReady: typeof pdf === "function" });
  });

  // Endpoint 1: Extract text and images from PDF
  app.post("/api/extract-text", async (req, res) => {
    try {
      console.log("Extraction request received");
      if (!req.files || !req.files.file) {
        return res.status(400).json({ error: "No file uploaded" });
      }

      const uploadedFile = req.files.file as any;
      const bufferData = Buffer.isBuffer(uploadedFile.data) ? uploadedFile.data : Buffer.from(uploadedFile.data);
      
      console.log(`Buffer size: ${bufferData.length} bytes`);

      // Full text extraction with pdf-parse
      if (typeof pdf !== "function") {
        throw new Error("PDF parser is not correctly initialized on server.");
      }
      
      const pdfData = await pdf(bufferData);
      const rawText = pdfData?.text || "";

      console.log(`Extracted text length: ${rawText.length}`);

      if (!rawText.trim()) {
        return res.status(400).json({ error: "No text found in PDF" });
      }

      // Simple image detection via regex on raw PDF stream
      const rawString = bufferData.toString("binary");
      const imageMatches = rawString.match(/\/Subtype\s*\/Image/g) || [];
      const imagesCount = imageMatches.length;

      res.json({ text: rawText, imagesCount });
    } catch (error: any) {
      console.error("Extraction error:", error);
      res.status(500).json({ error: error?.message || "Failed to extract text" });
    }
  });

  // Endpoint 2: Generate Docx from structured JSON
  app.post("/api/generate-docx", async (req, res) => {
    try {
      const structuredCourse = req.body;
      
      const doc = new Document({
        sections: [{
          properties: {},
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: structuredCourse.title || "Cours Médical",
                      bold: true,
                      size: 20,
                      color: COLORS.primary,
                    }),
                    new TextRun({
                      text: ` | ${structuredCourse.matter || "Résidanat"}`,
                      size: 18,
                      color: COLORS.gray,
                    }),
                  ],
                  border: { bottom: { color: COLORS.border, space: 1, style: BorderStyle.SINGLE, size: 6 } },
                }),
              ],
            }),
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({
                      text: "Page ",
                      size: 18,
                      color: COLORS.gray,
                    }),
                    new TextRun({
                      children: [PageNumber.CURRENT],
                      size: 18,
                      color: COLORS.gray,
                    }),
                    new TextRun({
                      text: " sur ",
                      size: 18,
                      color: COLORS.gray,
                    }),
                    new TextRun({
                      children: [PageNumber.TOTAL_PAGES],
                      size: 18,
                      color: COLORS.gray,
                    }),
                  ],
                }),
                new Paragraph({
                  alignment: AlignmentType.RIGHT,
                  children: [
                    new TextRun({
                      text: "Residanat Formatter - IA Enhanced",
                      size: 14,
                      italics: true,
                      color: COLORS.gray,
                    }),
                  ],
                }),
              ],
            }),
          },
          children: [
            // Page de garde
            new Paragraph({
              text: (structuredCourse?.title || "Cours").trim(),
              heading: HeadingLevel.TITLE,
              alignment: AlignmentType.CENTER,
              spacing: { before: 2400, after: 600 },
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: (structuredCourse?.matter || "").trim(),
                  size: 28,
                  bold: true,
                  color: COLORS.secondary,
                }),
              ],
              spacing: { after: 2400 },
            }),
            
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                new TextRun({
                  text: "Document généré par Residanat Formatter IA",
                  size: 16,
                  color: COLORS.gray,
                  italics: true,
                }),
              ],
            }),
            
            new Paragraph({ text: "Table des Matières", heading: HeadingLevel.HEADING_1, pageBreakBefore: true }),
            new TableOfContents("Sommaire", {
                hyperlink: true,
            }),

            // Objectifs
            new Paragraph({ text: "Objectifs Pédagogiques", heading: HeadingLevel.HEADING_1, pageBreakBefore: true }),
            ...(structuredCourse?.objectives || []).map((obj: string) => 
               new Paragraph({
                 text: obj,
                 bullet: { level: 0 },
                 spacing: { before: 120 },
               })
            ),

            // Sections
            ...(structuredCourse?.sections || []).flatMap((section: any) => {
              const nodes = [];
              const heading = section.level === 1 ? HeadingLevel.HEADING_1 : (section.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3);
              
              nodes.push(new Paragraph({
                text: section.title || "Sans titre",
                heading: heading,
                spacing: { before: 400, after: 200 },
              }));

              (section.content || []).forEach((item: any) => {
                if (item.type === "paragraph") {
                  nodes.push(createRichParagraph(enrichText(item.text || "", structuredCourse?.keyTerms || [])));
                } else if (item.type === "image_placeholder" || item.type === "annex") {
                   const isAnnex = item.type === "annex";
                   nodes.push(new Paragraph({
                    alignment: AlignmentType.CENTER,
                    children: [
                      new TextRun({
                        text: isAnnex ? "📎 ANNEXE / TABLEAU TRANSCRIT" : "📸 EMPLACEMENT ILLUSTRATION", 
                        bold: true, 
                        color: isAnnex ? COLORS.secondary : COLORS.primary,
                        size: 24
                      }),
                      new TextRun({
                        text: `\n${item.description || item.text || "Consulter le PDF pour le détail."}`,
                        italics: true,
                        color: COLORS.gray,
                        size: 18
                      }),
                      new TextRun({
                        text: isAnnex ? "" : "\n\n(ESPACE RÉSERVÉ POUR VOTRE CAPTURE D'ÉCRAN)\n\n\n\n\n\n\n\n",
                        size: 14,
                        color: COLORS.border
                      })
                    ],
                    border: { 
                      top: { style: BorderStyle.SINGLE, size: 8, color: isAnnex ? COLORS.secondary : COLORS.primary },
                      bottom: { style: BorderStyle.SINGLE, size: 8, color: isAnnex ? COLORS.secondary : COLORS.primary },
                      left: { style: BorderStyle.SINGLE, size: 8, color: isAnnex ? COLORS.secondary : COLORS.primary },
                      right: { style: BorderStyle.SINGLE, size: 8, color: isAnnex ? COLORS.secondary : COLORS.primary },
                    },
                    shading: {
                      type: ShadingType.SOLID,
                      color: isAnnex ? "EBEEF5" : "F8FAFC",
                      fill: isAnnex ? "EBEEF5" : "F8FAFC",
                    },
                    spacing: { before: 800, after: 4000 },
                  }));
                } else if (item.type === "list") {
                  (item.items || []).forEach((listItem: string) => {
                    nodes.push(new Paragraph({
                      text: listItem,
                      bullet: { level: 0 },
                    }));
                  });
                } else if (item.type === "important") {
                   nodes.push(new Paragraph({
                    spacing: { before: 160, after: 160 },
                    border: { left: { style: BorderStyle.SINGLE, size: 16, color: COLORS.secondary, space: 8 } },
                    shading: { fill: COLORS.accent, type: ShadingType.CLEAR },
                    children: [
                      new TextRun({ text: "À retenir — ", bold: true, font: "Arial", size: 22, color: COLORS.primary }),
                      new TextRun({ text: item.text || "", font: "Arial", size: 22, color: COLORS.primary }),
                    ],
                  }));
                } else if (item.type === "alert") {
                  nodes.push(new Paragraph({
                    spacing: { before: 160, after: 160 },
                    border: { left: { style: BorderStyle.SINGLE, size: 16, color: COLORS.warningBorder, space: 8 } },
                    shading: { fill: COLORS.warning, type: ShadingType.CLEAR },
                    children: [
                      new TextRun({ text: "⚠  ", bold: true, font: "Arial", size: 22, color: COLORS.warningBorder }),
                      new TextRun({ text: item.text || "", bold: true, font: "Arial", size: 22, color: "B7490A" }),
                    ],
                  }));
                }
              });

              return nodes;
            })
          ],
        }],
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader("Content-Disposition", `attachment; filename="reformate.docx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.send(buffer);

    } catch (error) {
      console.error("Docx generation error:", error);
      res.status(500).json({ error: "Failed to generate document" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
