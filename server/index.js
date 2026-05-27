import 'dotenv/config'; // require('dotenv').config() ki jagah
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { ChatOpenAI } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/community/vectorstores/qdrant';
import { QdrantClient } from '@qdrant/js-client-rest';
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";

const app = express();
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

const PORT = process.env.PORT || 8000;



// Multer Config: Uploaded files 'uploads/' folder me jayengi
const upload = multer({ dest: 'uploads/' });

// Valkey/Redis Connection for BullMQ
const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, tls: {} });
const pdfQueue = new Queue('pdf-ingestion', { connection });

// Qdrant aur OpenAI Setup
const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY
});


async function ensureQdrantSetup() {
  try {
    await qdrantClient.createCollection("pdf_chats", {
      vectors: {
        size: 384, // ya jo tumhara embedding dimension hai
        distance: "Cosine",
      },
    });
    console.log("Collection created");
  } catch (error) {
    console.log("Collection already exists or create skipped");
  }

  try {
    await qdrantClient.createPayloadIndex("pdf_chats", {
      field_name: "metadata.source",
      field_schema: "keyword",
    });
    console.log("Payload index created for metadata.source");
  } catch (error) {
    console.log("Payload index already exists or create skipped");
  }
}


const embeddings = new HuggingFaceInferenceEmbeddings({
  apiKey: process.env.HUGGINGFACE_API_KEY, // Aapka hf_... wala token yahan jayega
  model: "BAAI/bge-small-en-v1.5",
  inferenceArgs: {
    provider: "hf-inference"
  }
  // Free open-source model
});

// Health Check Route
app.get('/', (req, res) => res.json({ status: "Server is running smoothly!" }));

// Step 1 Route: PDF Upload aur Queue me Job dalna [00:48:58]
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Please upload a PDF file" });

    // Job ko Valkey Queue me push karna
    const job = await pdfQueue.add('process-pdf', {
      filename: req.file.originalname,
      path: req.file.path,
    });

    return res.json({ success: true, jobId: job.id, message: "PDF queued for processing asynchronously!" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

// Step 2 Route: Chat & Similarity Search [01:39:16]
app.post('/api/chat', async (req, res) => {
  try {
    const { message, pdfName } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
      client: qdrantClient,
      collectionName: 'pdf_chats',
    });

    const filter = pdfName
      ? {
        must: [
          {
            key: "metadata.source",
            match: { value: pdfName },
          },
        ],
      }
      : undefined;

    const relevantDocs = await vectorStore.similaritySearch(message, 3, filter);

    if (!relevantDocs.length) {
      return res.json({
        answer: "No relevant content found for the selected PDF.",
        sources: [],
      });
    }

    const context = relevantDocs.map(doc => doc.pageContent).join('\n\n');

    const model = new ChatOpenAI({
      model: 'llama-3.3-70b-versatile',
      apiKey: process.env.GROQ_API_KEY,
      configuration: {
        baseURL: "https://api.groq.com/openai/v1"
      }
    });

    const prompt = `Context from PDF:
${context}

Question: ${message}

Answer the question based strictly on the context provided. If the answer is not present in the context, say that clearly.`;

    const response = await model.invoke(prompt);

    return res.json({
      answer: response.content,
      sources: relevantDocs.map(doc => doc.metadata?.source || 'Unknown')
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/job-status/:id', async (req, res) => {
  const job = await pdfQueue.getJob(req.params.id);
  if (!job) return res.status(404).json({ error: "Job not found" });

  const state = await job.getState(); // 'completed', 'active', 'failed'
  return res.json({ state });
});


app.get("/api/pdfs", async (req, res) => {
  try {
    const allSources = new Set();
    let offset = null;

    do {
      const response = await qdrantClient.scroll("pdf_chats", {
        limit: 100,
        offset,
        with_payload: true,
        with_vector: false,
      });

      const points = response.points || [];

      for (const point of points) {
        const source = point.payload?.metadata?.source;
        if (source) allSources.add(source);
      }

      offset = response.next_page_offset ?? null;
    } while (offset !== null);

    return res.json({
      success: true,
      pdfs: Array.from(allSources).sort(),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.delete("/api/pdfs/:pdfName", async (req, res) => {
  try {
    const pdfName = req.params.pdfName;
    console.log("Deleting PDF:", pdfName);

    const result = await qdrantClient.delete("pdf_chats", {
      filter: {
        must: [
          {
            key: "metadata.source",
            match: { value: pdfName },
          },
        ],
      },
      wait: true,
    });

    console.log("Qdrant delete result:", result);

    return res.json({
      success: true,
      message: `${pdfName} deleted successfully`,
      result,
    });
  } catch (error) {
    console.error("DELETE PDF ERROR:", error);
    return res.status(500).json({
      success: false,
      error: error?.message || "Unknown delete error",
      details: error,
    });
  }
});

async function startServer() {
  await ensureQdrantSetup();

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer();