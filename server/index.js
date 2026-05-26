import 'dotenv/config'; // require('dotenv').config() ki jagah
import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { ChatOpenAI } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/community/vectorstores/qdrant';
import { QdrantClient } from '@qdrant/js-client-rest';
import fs from 'fs';
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";

// import { ChatGroq } from "@langchain/groq";



const app = express();
app.use(cors());
app.use(express.json());

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
// const embeddings = new OpenAIEmbeddings({ openAIApiKey: process.env.OPENAI_API_KEY });

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
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: "Message is required" });

    // Qdrant se existing collection connect karna
    const vectorStore = await QdrantVectorStore.fromExistingCollection(embeddings, {
      client: qdrantClient,
      collectionName: 'pdf_chats',
    });

    // Similarity Search: Top 3 relevant match uthana
    const relevantDocs = await vectorStore.similaritySearch(message, 3);
    const context = relevantDocs.map(doc => doc.pageContent).join('\n\n');

    // OpenAI Model Call
    // const model = new ChatOpenAI({ model: 'gpt-4o-mini', openAIApiKey: process.env.OPENAI_API_KEY });

    // Model initialization ko badal kar aisa kijiye:
    const model = new ChatOpenAI({
      model: 'llama-3.3-70b-versatile', // Groq ka superfast aur free model
      apiKey: process.env.GROQ_API_KEY,  // Groq ki API key
      configuration: {
        baseURL: "https://api.groq.com/openai/v1" // 📍 Yeh line request ko Groq server par bhej degi
      }
    });
    const prompt = `Context from PDF:\n${context}\n\nQuestion: ${message}\n\nAnswer the question based strictly on the context provided.`;

    const response = await model.invoke(prompt);

    return res.json({
      answer: response.content,
      sources: relevantDocs.map(doc => doc.metadata.source || 'Unknown')
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

app.listen(8000, () => console.log('🚀 Express Server running on http://localhost:8000'));