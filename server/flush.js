import 'dotenv/config';
import IORedis from 'ioredis';

async function flushRedis() {
  console.log("🔄 Connecting to Cloud Redis...");
  
  // Aapka .env se URL uthayega jo index.js me configured hai
  const connection = new IORedis(process.env.REDIS_URL, { tls: {} });

  try {
    const response = await connection.flushall();
    console.log(`🧹 Success! Redis response: ${response} (Saara data saaf ho gaya)`);
  } catch (error) {
    console.error("❌ Flush karne me error aayi:", error.message);
  } finally {
    connection.disconnect();
    process.exit(0);
  }
}

flushRedis();