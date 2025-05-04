'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
    useIotaClient,
    // useSignAndExecuteTransaction, // Not used directly for backend
    useCurrentAccount,
} from '@iota/dapp-kit';
// import { Transaction } from '@iota/iota-sdk/transactions'; // Not needed for backend
// Use string for Transaction Digest/ID, as specific type export is unclear
// import type { TransactionId } from '@iota/sdk';
// import type { IObjectInfo } from '@iota/sdk'; // Not used
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle, XCircle, Upload } from "lucide-react";
import Confetti from 'react-confetti';


// Constants for action types (Using simple strings now)
// const ACTION_TYPE_TEMP = "TEMP_OVER_15_SEOUL"; // Commenting out unused action
const ACTION_TYPE_TRANSPORT = "SUSTAINABLE_TRANSPORT_KM";

// API URL (remains the same)
const ATTESTATION_PROVIDER_API_URL = process.env.NEXT_PUBLIC_ATTESTATION_PROVIDER_URL || 'http://localhost:3001';

interface ActionStatus {
    lastRecordedTimestamp: number; // Still useful UI info
    // isVerifying: boolean;
    // verifyError: string | null;
    // verifySuccessMessage: string | null;
    // isClaiming: boolean;
    // claimError: string | null;
    claimSuccessTx: string | null; // Store IOTA digest (Transaction ID/Digest is a string)
    // canClaim: boolean;
    // File handling state (remains the same)
    selectedFile: File | null;
    selectedFileName: string;
    isReadingFile: boolean;
    imagePreviewUrl: string | null;
    // New state for single API call
    isLoading: boolean;
    apiError: string | null;
}

export default function ActionsPage() {
    const account = useCurrentAccount();
    const client = useIotaClient();
    // const { mutate: signAndExecuteTransaction, isPending: isTxPending } = useSignAndExecuteTransaction(); // Removed as tx built on backend

    // Config
    // const userActionsPackageId = useNetworkVariable('userActionsPackageId'); // Likely not needed if timestamp fetching removed/changed
    // const nftPackageId = useNetworkVariable('nftPackageId'); // NFT package used by backend
    // Add specific Object IDs if needed for calls (e.g., a shared UserActions object)
    // const userActionsObjectId = useNetworkVariable('userActionsObjectId');

    const [showConfetti, setShowConfetti] = useState(false);
    const [actionStatuses, setActionStatuses] = useState<{
        [key: string]: ActionStatus
    }>(() => ({
        // [ACTION_TYPE_TEMP]: {
        //     lastRecordedTimestamp: 0, isVerifying: false, verifyError: null, verifySuccessMessage: null,
        //     isClaiming: false, claimError: null, claimSuccessTx: null, canClaim: false,
        //     selectedFile: null, selectedFileName: '', isReadingFile: false, imagePreviewUrl: null,
        //     validationId: null, pollingIntervalId: null, currentStatus: null, backendStatus: null,
        //     verificationData: null,
        //     isLoading: false, apiError: null, // Initialize new state
        // },
        [ACTION_TYPE_TRANSPORT]: {
            lastRecordedTimestamp: 0, // Keep timestamp for UI info
            claimSuccessTx: null,
            selectedFile: null, selectedFileName: '', isReadingFile: false, imagePreviewUrl: null,
            isLoading: false, apiError: null, // Initialize new state
        },
    }));

    const updateActionStatus = (actionType: string, updates: Partial<ActionStatus>) => {
        setActionStatuses(prev => ({
            ...prev,
            [actionType]: { ...prev[actionType], ...updates }
        }));
    };

    // --- Fetch Last Action Timestamps (Optional - Can be removed if not needed) ---
    const fetchLastActionTimestamp = useCallback(async (actionType: string) => {
        if (!client || !account?.address /*|| !userActionsPackageId*/) return; // userActionsPackageId might not be needed now

        console.log(`Fetching last timestamp for ${actionType}...`);
        try {
            // Placeholder:
            console.warn(`fetchLastActionTimestamp: Placeholder for ${actionType}. Returning 0.`);
             updateActionStatus(actionType, { lastRecordedTimestamp: 0 });

        } catch (error: any) {
            console.error(`Error fetching last timestamp for ${actionType}:`, error);
            toast.error(`Failed to fetch status for ${actionType}: ${error.message}`);
            updateActionStatus(actionType, { apiError: `Failed to fetch status: ${error.message}` });
        }
    }, [client, account?.address]);

    // Fetch timestamps on initial load / account change
    useEffect(() => {
        if (client && account?.address) {
            fetchLastActionTimestamp(ACTION_TYPE_TRANSPORT);
        }
    }, [client, account?.address, fetchLastActionTimestamp]);

    // --- File Handling (Unchanged) ---
    const handleFileChange = (actionType: string, event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            updateActionStatus(actionType, {
                selectedFile: file,
                selectedFileName: file.name,
                apiError: null, // Clear errors on new file select
                imagePreviewUrl: URL.createObjectURL(file) // Create preview URL
            });
        } else {
             updateActionStatus(actionType, {
                 selectedFile: null,
                 selectedFileName: '',
                 imagePreviewUrl: null
             });
        }
    };

    const readFileAsBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    resolve(reader.result); // Resolve with the full data URI string
                } else {
                    reject(new Error("Failed to read file as Base64 string"));
                }
            };
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(file);
        });
    };

    // --- NEW: Single Handler for Requesting Attestation --- //
    const handleRequestAttestation = async (actionType: string) => {
        const status = actionStatuses[actionType];
        if (!account?.address || !status.selectedFile || status.isLoading) {
            toast.error("Wallet not connected, no file selected, or already processing.");
            return;
        }

        updateActionStatus(actionType, { isLoading: true, apiError: null, claimSuccessTx: null });
        setShowConfetti(false); // Reset confetti

        try {
            const imageBase64 = await readFileAsBase64(status.selectedFile);

            const response = await fetch(`${ATTESTATION_PROVIDER_API_URL}/request-attestation`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    actionType,
                    userAddress: account.address,
                    imageBase64,
                }),
            });

            const responseData = await response.json(); // Read response body once

            if (!response.ok) {
                throw new Error(responseData.error || `API Error: ${response.statusText}`);
            }

            console.log('Request attestation successful:', responseData);

            updateActionStatus(actionType, {
                claimSuccessTx: responseData.transactionDigest,
                isLoading: false,
                apiError: null,
                selectedFile: null, // Clear file on success
                selectedFileName: '',
                imagePreviewUrl: null,
            });

            toast.success(`NFT Minted! Tx: ${responseData.transactionDigest.substring(0, 10)}...`);
            setShowConfetti(true);
            setTimeout(() => setShowConfetti(false), 5000); // Confetti for 5s

        } catch (error: any) {
            console.error(`Error requesting attestation for ${actionType}:`, error);
            updateActionStatus(actionType, { isLoading: false, apiError: error.message || 'Failed to request attestation.' });
            toast.error(`Error: ${error.message || 'Failed to submit proof.'}`);
        }
    };

    // --- Render Action Card ---
    const renderActionCard = (actionType: string, title: string, description: string) => {
        const status = actionStatuses[actionType];
        const isTransport = actionType === ACTION_TYPE_TRANSPORT;

        // Format timestamp for display
        const lastActionDate = status.lastRecordedTimestamp > 0
            ? new Date(status.lastRecordedTimestamp * 1000).toLocaleString() // Assuming timestamp is in seconds
            : 'Never';

        return (
            <Card>
                <CardHeader>
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                    <a
                        href="/images/sample-fitness-screenshot.webp" // <-- IMPORTANT: Update filename/extension if needed
                        download="sample-fitness-screenshot"   // <-- Suggests filename to browser
                        className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
                    >
                        Download Sample Screenshot
                    </a>
                    {/* Optional: Keep last recorded timestamp display */}
                    {/* <p className="text-sm text-muted-foreground pt-2">Last recorded: {status.lastRecordedTimestamp > 0 ? new Date(status.lastRecordedTimestamp).toLocaleString() : 'Never'}</p> */}
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* File Upload for Transport */}
                    {isTransport && (
                        <div className="space-y-2">
                            <label htmlFor={`file-upload-${actionType}`} className="text-sm font-medium">
                                Upload Proof (Screenshot):
                            </label>
                            <Input
                                id={`file-upload-${actionType}`}
                                type="file"
                                accept="image/*" // Accept images
                                onChange={(e) => handleFileChange(actionType, e)}
                                disabled={status.isLoading || status.isReadingFile || !!status.claimSuccessTx}
                            />
                            {status.selectedFileName && !status.claimSuccessTx && <p className="text-sm text-muted-foreground">Selected: {status.selectedFileName}</p>}
                            {status.isReadingFile && (
                                 <p className="text-xs text-muted-foreground flex items-center"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Reading file...</p>
                            )}
                             {status.imagePreviewUrl && !status.claimSuccessTx && (
                                <img src={status.imagePreviewUrl} alt="Preview" className="mt-2 max-h-40 rounded border" />
                             )}
                        </div>
                    )}

                    {/* Status Display Area - Simplified */}
                    {status.apiError && (
                        <Alert variant="destructive">
                            <XCircle className="h-4 w-4" />
                            <AlertTitle>Verification Error</AlertTitle>
                            <AlertDescription>{status.apiError}</AlertDescription>
                        </Alert>
                    )}
                    {status.claimSuccessTx && (
                        <Alert variant="default">
                             <CheckCircle className="h-4 w-4 text-green-500" />
                            <AlertTitle>NFT Minted Successfully!</AlertTitle>
                            <AlertDescription>
                                Transaction Digest:
                                <a
                                     href={`https://explorer.rebased.iota.org/txblock/${status.claimSuccessTx}?network=testnet`} // Adjust explorer URL based on client network info
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="ml-1 underline font-mono text-xs break-all"
                                    title={status.claimSuccessTx}
                                >
                                     {status.claimSuccessTx.substring(0, 10)}...
                                </a>
                            </AlertDescription>
                        </Alert>
                    )}

                </CardContent>
                <CardFooter className="flex justify-end space-x-2">
                    {/* Verify Button */}
                    {/* <Button
                        onClick={() => handleSubmitProofs(actionType)}
                        disabled={!account || !status.selectedFile || status.isVerifying || status.isClaiming || !!status.validationId || status.canClaim}
                        variant="outline"
                    >
                        {status.isVerifying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Verify Proof
                    </Button> */} 

                    {/* Single Submit Button */}
                    <Button
                        onClick={() => handleRequestAttestation(actionType)}
                        disabled={!account || !status.selectedFile || status.isLoading || !!status.claimSuccessTx}
                    >
                        {status.isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Submit Proof & Mint NFT
                    </Button>

                    {/* Claim Button */}
                    {/* <Button
                        onClick={() => handleClaimNft(actionType)}
                        disabled={!account || !status.canClaim || status.isClaiming || isTxPending || !!status.claimSuccessTx}
                    >
                        {(status.isClaiming || isTxPending) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                        Claim NFT
                    </Button> */} 
                </CardFooter>
            </Card>
        );
    };

    return (
        <div className="space-y-6">
            {showConfetti && <Confetti recycle={false} numberOfPieces={300} />}
            <h1 className="text-3xl font-bold tracking-tight">Record Environmental Actions</h1>
            <p className="text-muted-foreground">
                Verify your real-world actions via an attestation provider and claim corresponding Carbon Credit NFTs on the IOTA network.
            </p>

             {!account && (
                 <p className="text-center text-muted-foreground py-10">Please connect your wallet to record actions.</p>
             )}

             {account && (
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Render card for Temp action */}
                     {/* {renderActionCard(
                         ACTION_TYPE_TEMP,
                         "Temperature Check",
                         "Verify if the temperature in Seoul is over 15°C (Placeholder - requires attestation provider integration without file upload)."
                     )} */}
                     {renderActionCard(
                         ACTION_TYPE_TRANSPORT,
                         "Sustainable Transport",
                         "Upload proof (e.g., Garmin/Strava screenshot > 5km) of cycling or walking. The corresponding Carbon Credit NFT will be minted directly to your wallet."
                     )}
                 </div>
             )}
        </div>
    );
}