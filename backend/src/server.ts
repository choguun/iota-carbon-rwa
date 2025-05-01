import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import OpenAI from 'openai';

dotenv.config();

const openaiApiKey = process.env.OPENAI_API_KEY;

if (!openaiApiKey) throw new Error("OPENAI_API_KEY is not set in .env");

const openai = new OpenAI({
    apiKey: openaiApiKey,
});

// --- API Endpoints ---

const app = express();
const port = process.env.PROVIDER_PORT || 3001;

// Middleware
app.use(cors()); // Enable CORS for requests from the frontend
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies with a larger limit


// Error Handling Middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, () => {
    console.log(`Attestation Provider listening on port ${port}`);
});
