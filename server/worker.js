import 'dotenv/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import fs from 'fs/promises';

import { PDFParse } from 'pdf-parse';

import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter';
import { OpenAIEmbeddings } from '@langchain/openai';
import { QdrantVectorStore } from '@langchain/community/vectorstores/qdrant';
import { QdrantClient } from '@qdrant/js-client-rest';
import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";


const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null, tls: {} });
const qdrantClient = new QdrantClient({
  url: process.env.QDRANT_URL,
  apiKey: process.env.QDRANT_API_KEY
});
const embeddings = new HuggingFaceInferenceEmbeddings({
  apiKey: process.env.HUGGINGFACE_API_KEY,
  model: "BAAI/bge-small-en-v1.5",
  inferenceArgs: {
    provider: "hf-inference"
  }
});

console.log('👷 Worker process is listening for jobs...');

const worker = new Worker('pdf-ingestion', async (job) => {
  const { filename, path } = job.data;
  console.log(`[Processing Started] Job ID: ${job.id} | File: ${filename}`);

  try {
    const dataBuffer = await fs.readFile(path);

    const parser = new PDFParse({ data: dataBuffer });
    const textData = await parser.getText(); // PDF se text nikalna

    await parser.destroy();

    if (!textData || !textData.text) {
      throw new Error("PDF se text extraction fail ho gaya ya file khali hai.");
    }

    // 2. Chunks me split karna [00:05:58]
    const splitter = new RecursiveCharacterTextSplitter({ chunkSize: 1000, chunkOverlap: 200 });
    const docs = await splitter.createDocuments([textData.text], [{ source: filename }]);

    // 3. Embeddings banakar Qdrant me store karna [00:06:20]

    // await qdrantClient.delete('pdf_chats', {
    //   filter: {
    //     must: [
    //       {
    //         match: {
    //           any: "*" // 🧠 Iska matlab: Saare points match karo aur delete kar do!
    //         }
    //       }
    //     ]
    //   }
    // });

    await QdrantVectorStore.fromDocuments(docs, embeddings, {
      client: qdrantClient,
      collectionName: 'pdf_chats',
      // recreateCollection: true // 🔥 Yeh option bina kisi 'Bad Request' ke automatically collection ko wipe karke naya data insert kar deta hai!
    });

    console.log(`[Success] Finished processing: ${filename}`);

    // 4. Temporary uploaded file delete karna
    await fs.unlink(path);
  } catch (error) {
    console.error(`[Error] Failed processing Job ${job.id}:`, error.message);
    throw error;
  }
}, { connection });