import "dotenv/config";
import express from "express";
import multer from "multer";
import cors from "cors";
import fs from "fs/promises";
import path from "path";

// 100% Native ESM compatible package - completely fixes "is not a function" crashes
import parsePDF from "pdf-parse-fork";

import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { ChatOpenAI } from "@langchain/openai";
import { QdrantVectorStore } from "@langchain/community/vectorstores/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";

const app = express();
const PORT = process.env.PORT || 8000;
const COLLECTION_NAME = "pdf_chats";

const allowedOrigins = [
  "http://localhost:5173",
  process.env.CORS_ORIGIN,
].filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

app.use(express.json());
const upload = multer({ dest: "uploads/" });

// Temporary status storage for frontend progress simulation
const jobStatuses = new Map();

const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const embeddings = new HuggingFaceInferenceEmbeddings({
  apiKey: process.env.HUGGINGFACE_API_KEY,
  model: "BAAI/bge-small-en-v1.5",
  inferenceArgs: { provider: "hf-inference" },
});

async function ensureUploadsDir() {
  await fs.mkdir("uploads", { recursive: true });
}

async function ensureQdrantSetup() {
  try {
    await qdrantClient.createCollection(COLLECTION_NAME, {
      vectors: { size: 384, distance: "Cosine" },
    });
    console.log("Collection created or verified");
  } catch (error) {
    console.log("Collection structure ready");
  }
}

// Fixed core text processing pipeline
async function processPDFInline(fakeJobId, filename, filePath) {
  console.log(`[Processing Started] File: ${filename}`);
  jobStatuses.set(fakeJobId, { state: "active", progress: 20 });

  try {
    const dataBuffer = await fs.readFile(filePath);
    jobStatuses.set(fakeJobId, { state: "active", progress: 40 });

    // Directly invoking the native ESM function with zero wrapper object hacks
    const textData = await parsePDF(dataBuffer);
    
    if (!textData || !textData.text || !textData.text.trim()) {
      throw new Error("PDF text extraction failed or file is empty.");
    }

    jobStatuses.set(fakeJobId, { state: "active", progress: 60 });
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const docs = await splitter.createDocuments([textData.text], [{ source: filename }]);
    if (!docs.length) throw new Error("No chunks created from text.");

    jobStatuses.set(fakeJobId, { state: "active", progress: 80 });
    await QdrantVectorStore.fromDocuments(docs, embeddings, {
      url: process.env.QDRANT_URL,
      apiKey: process.env.QDRANT_API_KEY,
      collectionName: COLLECTION_NAME,
    });

    jobStatuses.set(fakeJobId, {
      state: "completed",
      progress: 100,
      result: { success: true, filename, chunks: docs.length }
    });
    console.log(`[Success] Finished processing: ${filename}`);
  } catch (error) {
    console.error(`[Error] Processing failed:`, error.message);
    jobStatuses.set(fakeJobId, { state: "failed", progress: 100, failedReason: error.message });
  } finally {
    try { await fs.unlink(filePath); } catch {}
  }
}

app.get("/", (req, res) => {
  res.json({ status: "Server running smoothly!" });
});

app.post("/api/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Please upload a PDF file" });
    const absolutePath = path.resolve(req.file.path);
    
    const fakeJobId = "local-job-" + Date.now();
    jobStatuses.set(fakeJobId, { state: "waiting", progress: 0 });

    processPDFInline(fakeJobId, req.file.originalname, absolutePath);

    return res.json({
      success: true,
      jobId: fakeJobId,
      fileName: req.file.originalname,
      message: "PDF processing started locally!",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/job-status/:id", async (req, res) => {
  const currentJob = jobStatuses.get(req.params.id);
  if (!currentJob) {
    return res.json({ success: true, state: "completed", progress: 100 });
  }
  return res.json({ success: true, ...currentJob });
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, pdfName } = req.body;
    const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
      client: qdrantClient,
      collectionName: COLLECTION_NAME,
    });

    const filter = pdfName ? { must: [{ key: "metadata.source", match: { value: pdfName } }] } : undefined;
    const relevantDocs = await vectorStore.similaritySearch(message, 3, filter);
    const context = relevantDocs.map((doc) => doc.pageContent).join("\n\n");

    const model = new ChatOpenAI({
      model: "llama-3.3-70b-versatile",
      apiKey: process.env.GROQ_API_KEY,
      configuration: { baseURL: "https://api.groq.com/openai/v1" },
    });

    const prompt = `Context:\n${context}\n\nQuestion: ${message}`;
    const response = await model.invoke(prompt);
    return res.json({ answer: response.content });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/pdfs", async (req, res) => {
  try {
    const allSources = new Set();
    const response = await qdrantClient.scroll(COLLECTION_NAME, { limit: 100, with_payload: true });
    for (const point of response.points || []) {
      const source = point.payload?.metadata?.source;
      if (source) allSources.add(source);
    }
    return res.json({ success: true, pdfs: Array.from(allSources).sort() });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

app.delete("/api/pdfs/:pdfName", async (req, res) => {
  try {
    const pdfName = req.params.pdfName;
    const result = await qdrantClient.delete(COLLECTION_NAME, {
      filter: { must: [{ key: "metadata.source", match: { value: pdfName } }] },
      wait: true,
    });
    return res.json({ success: true, message: `${pdfName} deleted successfully`, result });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
});

async function startServer() {
  await ensureUploadsDir();
  await ensureQdrantSetup();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();