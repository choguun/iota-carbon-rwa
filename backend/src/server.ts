import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import cors from 'cors';
import OpenAI from 'openai';
import crypto from 'crypto';

import { IotaClient, getFullnodeUrl } from '@iota/iota-sdk/client';
import { Transaction } from '@iota/iota-sdk/transactions';
import { Ed25519Keypair } from '@iota/iota-sdk/keypairs/ed25519';
import { bcs } from '@iota/iota-sdk/bcs';
import { Buffer } from 'buffer';

interface VisionVerificationResult {
    activityType?: string; // e.g., "cycling", "walking", "other"
    distanceKm?: number;
    date?: string; // e.g., "YYYY-MM-DD"
    error?: string; // Error message from AI parsing
}

dotenv.config();

const openaiApiKey = process.env.OPENAI_API_KEY;
const iotaNodeUrl = process.env.IOTA_NODE_URL;
const iotaPackageId = process.env.IOTA_PACKAGE_ID;
const iotaAdminCapId = process.env.IOTA_ADMIN_CAP_ID;
const iotaVerificationRegistryId = process.env.IOTA_VERIFICATION_REGISTRY_ID;
const iotaDeployerPrivateKey = process.env.IOTA_DEPLOYER_PRIVATE_KEY;

if (!openaiApiKey) throw new Error("OPENAI_API_KEY is not set in .env");
if (!iotaNodeUrl) throw new Error("IOTA_NODE_URL is not set in .env");
if (!iotaPackageId) throw new Error("IOTA_PACKAGE_ID is not set in .env");
if (!iotaAdminCapId) throw new Error("IOTA_ADMIN_CAP_ID is not set in .env");
if (!iotaVerificationRegistryId) throw new Error("IOTA_VERIFICATION_REGISTRY_ID is not set in .env");
if (!iotaDeployerPrivateKey) throw new Error("IOTA_DEPLOYER_PRIVATE_KEY is not set in .env");

console.log("iotaPackageId: ", iotaPackageId);

// --- Constants ---
const EXPECTED_ACTION_TYPE_TRANSPORT = "SUSTAINABLE_TRANSPORT_KM";

const ACTIVITY_CODE_CYCLING = 1;
const ACTIVITY_CODE_WALKING = 2;
const EMISSION_FACTOR_CYCLING_PER_KM = 0.015; // Example kg CO2e per km
const EMISSION_FACTOR_WALKING_PER_KM = 0.020; // Example kg CO2e per km

const openai = new OpenAI({
    apiKey: openaiApiKey,
});

// Define asyncHandler before use
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<any>) => 
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

async function verifyTransportWithVision(base64Image: string): Promise<{ success: boolean; distance: number | null; details?: VisionVerificationResult; error?: string }> {
    console.log("Verifying transport screenshot with OpenAI Vision...");
    const minDistanceKm = 5; // Minimum required distance

    if (!base64Image || !base64Image.startsWith('data:image/')) {
        return { success: false, distance: null, error: "Invalid image data provided." };
    }

    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o",
            max_tokens: 3000,
            messages: [
                // --- System Prompt --- 
                {
                    role: "system",
                    content: "You are an AI assistant specialized in analyzing screenshots from fitness tracking apps (like Garmin Connect, Strava, etc.). Your task is to identify sustainable transport activities (cycling, walking, running, etc.), the distance covered in kilometers, and the date. You MUST respond ONLY with a single, valid JSON object containing the keys \"activityType\", \"distanceKm\", and \"date\". Do not include any explanations or introductory text. If you cannot reliably determine the required information, use \"other\" for activityType, null for distanceKm, or null for the date within the JSON structure."
                },
                // --- User Prompt --- 
                {
                    role: "user",
                    content: [
                        { 
                            type: "text", 
                            // User text now just presents the request, context is in system prompt
                            text: `Analyze the attached fitness app screenshot and provide the activity details in the required JSON format.` 
                        },
                        {
                            type: "image_url",
                            image_url: {
                                url: base64Image, // Send the full base64 string with prefix
                                detail: "low" // Use low detail for efficiency
                            },
                        },
                    ],
                },
            ],
        });

        const aiResponseContent = completion.choices[0]?.message?.content;
        
        // Ensure we have a non-empty string before proceeding
        if (typeof aiResponseContent !== 'string' || aiResponseContent.trim() === '') {
            console.error("OpenAI response content was invalid or empty:", aiResponseContent);
            throw new Error("OpenAI response content was invalid or empty.");
        }
        
        // Assign to a new constant after the type guard
        const responseString: string = aiResponseContent; 

        console.log("Raw OpenAI response:", responseString);

        // Attempt to parse the JSON response (remove potential markdown backticks)
        let parsedResponse: VisionVerificationResult;
        try {
            // Clean the response using the guaranteed string constant
            const cleanedResponse = responseString.replace(/^```json\n?|\n?```$/g, ''); 
            parsedResponse = JSON.parse(cleanedResponse);
        } catch (parseError) {
            console.error("Failed to parse JSON from OpenAI:", responseString);
            throw new Error(`AI did not return valid JSON. Response: ${responseString}`);
        }

        console.log("Parsed OpenAI response:", parsedResponse);

        // Validate the parsed data
        const { activityType, distanceKm } = parsedResponse;
        // Allow null values as per system prompt instruction if data is missing
        if (!activityType) {
             return { success: false, distance: null, details: parsedResponse, error: "AI response missing required field: activityType." };
        }
        if (activityType === 'other') {
            return { success: false, distance: distanceKm ?? null, details: parsedResponse, error: `Activity type identified as 'other' or could not be determined.` };
        }
        if (activityType !== "cycling" && activityType !== "walking") {
            // This case might be less likely if the system prompt works well, but keep as safeguard
            return { success: false, distance: distanceKm ?? null, details: parsedResponse, error: `Unsupported activity type detected: ${activityType}. Expected 'cycling' or 'walking'.` };
        }
        // Check distance if activity is valid
        if (distanceKm === null || typeof distanceKm !== 'number') {
             return { success: false, distance: null, details: parsedResponse, error: "AI response missing or invalid field: distanceKm." };
        }
         if (distanceKm < minDistanceKm) {
            return { success: false, distance: distanceKm, details: parsedResponse, error: `Distance ${distanceKm}km is less than the required ${minDistanceKm}km.` };
        }
        // Check date format if present
        // if (date === null) {
        //      return { success: false, distance: distanceKm, details: parsedResponse, error: "AI response missing required field: date." };
        // }
        
        // TODO: Add date validation (check against UserActions last recorded timestamp to prevent replay)

        console.log(`Vision verification successful: ${activityType}, ${distanceKm}km`);
        return { success: true, distance: distanceKm, details: parsedResponse };

    } catch (error: any) {
        console.error("Error during OpenAI Vision API call:", error);
        const errorMessage = error.response?.data?.error?.message || error.message || "Unknown error calling OpenAI Vision API.";
        return { success: false, distance: null, error: errorMessage };
    }
}

// --- API Endpoints ---

const app = express();
const port = process.env.PROVIDER_PORT || 3001;

// Middleware
app.use(cors()); // Enable CORS for requests from the frontend
app.use(express.json({ limit: '10mb' })); // Parse JSON bodies with a larger limit

// POST /request-attestation
app.post('/request-attestation', asyncHandler(async (req: Request, res: Response) => {
    const { actionType, userAddress, imageBase64 } = req.body;

    if (!actionType || !userAddress) {
        return res.status(400).json({ error: 'Missing required fields: actionType and userAddress' });
    }

    console.log(`Received attestation request for type: ${actionType}, user: ${userAddress}`);

    // --- Handle Sustainable Transport Action ---
    if (actionType === EXPECTED_ACTION_TYPE_TRANSPORT) {
        if (!imageBase64) {
            return res.status(400).json({ error: 'Missing imageBase64 for transport verification' });
        }

        // 1. Verify with OpenAI
        const visionResult = await verifyTransportWithVision(imageBase64);
        // Use optional chaining and nullish coalescing for safety
        const activityTypeString = visionResult.details?.activityType;
        const distanceKm = visionResult.distance;

        if (!visionResult.success || typeof distanceKm !== 'number' || !activityTypeString) {
            console.error("Vision verification failed or returned incomplete data:", visionResult.error);
            return res.status(400).json({ error: `Verification failed: ${visionResult.error || 'Unknown vision error'}` });
        }
        console.log("Vision verification successful:", visionResult.details);

        // 2. Prepare Minting Parameters
        let activityCode: number;
        let emissionFactor: number;

        switch (activityTypeString.toLowerCase()) {
            case 'cycling':
                activityCode = ACTIVITY_CODE_CYCLING;
                emissionFactor = EMISSION_FACTOR_CYCLING_PER_KM;
                break;
            case 'walking': // Add walking if applicable
            // case 'running': // Or other types supported by your contract
                activityCode = ACTIVITY_CODE_WALKING;
                emissionFactor = EMISSION_FACTOR_WALKING_PER_KM;
                break;
            default:
                // Should not happen if visionResult.success is true, but handle defensively
                console.error(`Unsupported activity type from vision: ${activityTypeString}`);
                return res.status(400).json({ error: `Unsupported activity type for minting: ${activityTypeString}. Only cycling and walking are supported.` });
        }

        // Calculate CO2e amount (convert kg to grams or chosen unit for u64)
        // Assuming the contract expects GRAMS
        const amountKgCo2e = distanceKm * emissionFactor;
        const amountGramsCo2e = Math.round(amountKgCo2e * 1000); 

        if (amountGramsCo2e <= 0) {
            return res.status(400).json({ error: `Calculated CO2e amount is not positive (${amountGramsCo2e}g)` });
        }

        // Generate verification ID (use a secure, unique ID)
        // Using a simple hash of user + timestamp + distance for now
        const verificationData = `${userAddress}-${Date.now()}-${distanceKm}-${activityCode}`;
        const verificationIdBytes = crypto.createHash('sha256').update(verificationData).digest();

        // 3. Initialize IOTA Client and Signer
        // initLogger(); // Optional: Initialize SDK logger
        let transactionDigest: string | undefined;

        try {
            console.log(`Connecting to node: ${iotaNodeUrl}`);
            const client = new IotaClient({ url: iotaNodeUrl });

            // Generate KeyPair from private key
            const deployerPrivateKeyBytes = Buffer.from(
                iotaDeployerPrivateKey.startsWith('0x') ? iotaDeployerPrivateKey.substring(2) : iotaDeployerPrivateKey,
                'hex'
            );
            // Ensure the private key is the correct length for Ed25519 (32 bytes)
            if (deployerPrivateKeyBytes.length !== 32) {
                throw new Error('Invalid Ed25519 private key length. Expected 32 bytes.');
            }
            const keypair = Ed25519Keypair.fromSecretKey(deployerPrivateKeyBytes);
     
            // --- DIAGNOSTIC: Try fetching input objects --- 
            try {
                console.log(`Attempting to fetch AdminCap object: ${iotaAdminCapId}`);
                const adminCapInfo = await client.getObject({ id: iotaAdminCapId });
                console.log("AdminCap Info:", JSON.stringify(adminCapInfo, null, 2));
                console.log(`Attempting to fetch VerificationRegistry object: ${iotaVerificationRegistryId}`);
                const registryInfo = await client.getObject({ id: iotaVerificationRegistryId });
                console.log("Registry Info:", JSON.stringify(registryInfo, null, 2));
            } catch (getObjectError: any) {
                console.error("DIAGNOSTIC FAILED: Error fetching input objects.", getObjectError);
                // If this fails with 403, the issue is likely node access/permissions for reading these objects.
                // Re-throw the error to stop execution here if object fetching fails.
                throw new Error(`Failed to fetch prerequisite objects: ${getObjectError.message}`);
            }
            // --- END DIAGNOSTIC ---

            const tx = new Transaction();
            tx.setGasBudget(100_000_000); // Set gas budget on the transaction

            // userAddress from frontend should already be hex (0x...)
            const recipientHex = userAddress;

            tx.moveCall({
                target: `${iotaPackageId}::carbon_nft_manager::mint_nft`,
                arguments: [
                    tx.object(iotaAdminCapId),                          // admin_cap: &AdminCap
                    tx.object(iotaVerificationRegistryId),              // registry: &mut VerificationRegistry
                    tx.pure.address(recipientHex),                      // recipient: address
                    tx.pure.u64(amountGramsCo2e),                       // amount_kg_co2e: u64
                    tx.pure.u8(activityCode),                           // activity_type: u8
                    tx.pure(bcs.vector(bcs.U8).serialize(verificationIdBytes)) // verification_id: vector<u8>
                ],
                typeArguments: []
            });

            // Log the final transaction JSON structure before sending
            console.log("Constructed mint_nft transaction JSON:", JSON.stringify(tx.toJSON(), null, 2));

            // 5. Sign and Submit the Prepared Transaction
            // const blockIdAndBlock = await deployerAccount.signAndSubmitTransaction(preparedTx);
            // console.log("Minting transaction submitted. Block ID:", blockIdAndBlock.blockId);

            const result = await client.signAndExecuteTransaction({
                signer: keypair,
                transaction: tx,
                requestType: 'WaitForLocalExecution', // Or 'WaitForEffectsCert'
                options: {
                    showEffects: true // Request effects to potentially see created objects
                }
            });
            console.log("Minting transaction submitted. Digest:", result.digest);


            // Wait for confirmation (optional but recommended)
            // Try awaitTransactionConfirmation
            // await client.awaitTransactionConfirmation(blockIdAndBlock.blockId);
            // console.log("Minting transaction included.");

            // 6. Wait for Transaction Confirmation using waitForTransaction
             await client.waitForTransaction({
                 digest: result.digest,
                 options: { showEffects: true } // Optional: fetch effects again after waiting
            });
            console.log("Minting transaction included and effects observable.");


            // Retrieve transaction details to get digest (if needed)
            // const txDetails = await client.getTransaction({ transactionId: blockIdAndBlock.blockId });
            // transactionDigest = txDetails.transactionId; // Adjust based on actual SDK response
            // transactionDigest = blockIdAndBlock.blockId; // Use block ID as digest for now
            transactionDigest = result.digest; // Assign the digest from the result


        } catch (txError: any) {
            console.error("IOTA Transaction failed:", txError);
            // Avoid sending detailed SDK errors to the client for security
            return res.status(500).json({ error: `Failed to mint NFT on-chain. Please try again later.` });
        }
        
        // 6. Return Success Response
        return res.status(200).json({ 
            message: "Verification successful. NFT minted.", 
            transactionDigest: transactionDigest, 
            mintedAmountGrams: amountGramsCo2e
        });

    } else {
        // Handle other action types or return error
        console.warn(`Unsupported action type received: ${actionType}`);
        return res.status(400).json({ error: `Unsupported action type: ${actionType}` });
    }
}));

// POST /submit-proofs/:validationId
app.post('/submit-proofs/:validationId', asyncHandler(async (req: Request, res: Response) => {
    const { validationId } = req.params;
    console.log(`Received request to submit proofs for validation ID: ${validationId}`);

    
    return res.status(200).json({ 
        message: 'Proofs submitted successfully.', 
        validationId: validationId, 
    });

}));

// Error Handling Middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: 'Internal Server Error' });
});

app.listen(port, () => {
    console.log(`Attestation Provider listening on port ${port}`);
});
