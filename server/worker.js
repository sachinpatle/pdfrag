import "dotenv/config";
import { Worker } from "bullmq";
import IORedis from "ioredis";
import fs from "fs/promises";
import { PDFParse } from "pdf-parse";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { QdrantVectorStore } from "@langchain/community/vectorstores/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";

const COLLECTION_NAME = "pdf_chats";

const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  tls: {},
});

const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY,
});

const embeddings = new HuggingFaceInferenceEmbeddings({
  apiKey: process.env.HUGGINGFACE_API_KEY,
  model: "BAAI/bge-small-en-v1.5",
  inferenceArgs: {
    provider: "hf-inference",
  },
});

console.log("👷 Worker process is listening for jobs...");

const worker = new Worker(
  "pdf-ingestion",
  async (job) => {
    const { filename, path } = job.data;
    let parser;

    console.log(`[Processing Started] Job ID: ${job.id} | File: ${filename}`);

    try {
      const dataBuffer = await fs.readFile(path);

      parser = new PDFParse({ data: dataBuffer });
      const textData = await parser.getText();

      if (!textData || !textData.text || !textData.text.trim()) {
        throw new Error("PDF se text extraction fail ho gaya ya file khali hai.");
      }

      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
      });

      const docs = await splitter.createDocuments([textData.text], [
        { source: filename },
      ]);

      if (!docs.length) {
        throw new Error("No chunks created from PDF.");
      }

      await QdrantVectorStore.fromDocuments(docs, embeddings, {
        client: qdrantClient,
        collectionName: COLLECTION_NAME,
      });

      console.log(`[Success] Finished processing: ${filename}`);

      return {
        success: true,
        filename,
        chunks: docs.length,
      };
    } catch (error) {
      console.error(`[Error] Failed processing Job ${job.id}:`, error.message);
      throw error;
    } finally {
      if (parser) {
        try {
          await parser.destroy();
        } catch {}
      }

      try {
        await fs.unlink(path);
      } catch {}
    }
  },
  { connection }
);

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed successfully.`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed: ${err.message}`);
});