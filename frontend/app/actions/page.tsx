'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
    useIotaClient,
    useSignAndExecuteTransaction,
    useCurrentAccount,
} from '@iota/dapp-kit';
import { Transaction } from '@iota/iota-sdk/transactions';
import type { TransactionDigest, IObjectInfo } from '@iota/sdk'; // Adjust imports if needed
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle, XCircle, Upload } from "lucide-react";
import { useNetworkVariable } from '@/lib/networkConfig'; // Assuming this exists
import Confetti from 'react-confetti';


// Constants for action types (Using simple strings now)
const ACTION_TYPE_TEMP = "TEMP_OVER_15_SEOUL";
const ACTION_TYPE_TRANSPORT = "SUSTAINABLE_TRANSPORT_KM";

// API URL (remains the same)
const ATTESTATION_PROVIDER_API_URL = process.env.NEXT_PUBLIC_ATTESTATION_PROVIDER_URL || 'http://localhost:3001';

interface ActionStatus {
    lastRecordedTimestamp: number; // Still useful UI info
    isVerifying: boolean;
    verifyError: string | null;
    verifySuccessMessage: string | null;
    isClaiming: boolean;
    claimError: string | null;
    claimSuccessTx: TransactionDigest | null; // Store IOTA digest
    canClaim: boolean;
    // File handling state (remains the same)
    selectedFile: File | null;
    selectedFileName: string;
    isReadingFile: boolean;
    imagePreviewUrl: string | null;
    // FDC flow state (remains the same)
    validationId: string | null;
    pollingIntervalId: NodeJS.Timeout | null;
    currentStatus: string | null;
    backendStatus: string | null; // e.g., 'pending_verification', 'complete', 'failed'
    // Store verification data needed for claim
    verificationData: any | null; // Store data from provider needed for the claim tx
}

export default function ActionsPage() {
    const account = useCurrentAccount();
    const client = useIotaClient();
    const { mutate: signAndExecuteTransaction, isPending: isTxPending } = useSignAndExecuteTransaction();

    // Config
    const userActionsPackageId = useNetworkVariable('userActionsPackageId');
    const nftPackageId = useNetworkVariable('nftPackageId');
    // Add specific Object IDs if needed for calls (e.g., a shared UserActions object)
    // const userActionsObjectId = useNetworkVariable('userActionsObjectId');

    const [showConfetti, setShowConfetti] = useState(false);
    const [actionStatuses, setActionStatuses] = useState<{
        [key: string]: ActionStatus
    }>(() => ({
        [ACTION_TYPE_TEMP]: {
            lastRecordedTimestamp: 0, isVerifying: false, verifyError: null, verifySuccessMessage: null,
            isClaiming: false, claimError: null, claimSuccessTx: null, canClaim: false,
            selectedFile: null, selectedFileName: '', isReadingFile: false, imagePreviewUrl: null,
            validationId: null, pollingIntervalId: null, currentStatus: null, backendStatus: null,
            verificationData: null, // Initialize verification data
        },
        [ACTION_TYPE_TRANSPORT]: {
            lastRecordedTimestamp: 0, isVerifying: false, verifyError: null, verifySuccessMessage: null,
            isClaiming: false, claimError: null, claimSuccessTx: null, canClaim: false,
            selectedFile: null, selectedFileName: '', isReadingFile: false, imagePreviewUrl: null,
            validationId: null, pollingIntervalId: null, currentStatus: null, backendStatus: null,
            verificationData: null, // Initialize verification data
        },
    }));

    const updateActionStatus = (actionType: string, updates: Partial<ActionStatus>) => {
        setActionStatuses(prev => ({
            ...prev,
            [actionType]: { ...prev[actionType], ...updates }
        }));
    };

    // --- Fetch Last Action Timestamps ---
    const fetchLastActionTimestamp = useCallback(async (actionType: string) => {
        if (!client || !account?.address || !userActionsPackageId) return;

        console.log(`Fetching last timestamp for ${actionType}...`);
        try {
            // --- Replace with actual IOTA contract call ---
            // Example: Assuming a view function `get_last_action_timestamp(owner: address, action_type: vector<u8>)`
            // Convert actionType string to bytes if needed by contract (e.g., UTF8)
            // const actionTypeBytes = new TextEncoder().encode(actionType);

            // const result = await client.callViewFunction({
            //     packageId: userActionsPackageId,
            //     module: 'user_actions', // Adjust module name
            //     function: 'get_last_action_timestamp',
            //     args: [
            //         account.address, // Assuming address type is compatible
            //         Array.from(actionTypeBytes) // Pass bytes as array if needed
            //     ],
            //     // typeArguments: []
            // });

            // // --- Parse result ---
            // let timestamp = 0;
            // if (result?.value) { // Adjust based on actual return structure
            //    try {
            //      timestamp = Number(result.value); // Assuming it returns a number/string convertible to number
            //      if (isNaN(timestamp)) timestamp = 0;
            //    } catch { timestamp = 0; }
            // }
            // console.log(`Fetched timestamp for ${actionType}: ${timestamp}`);
            // updateActionStatus(actionType, { lastRecordedTimestamp: timestamp });

            // Placeholder:
            console.warn(`fetchLastActionTimestamp: Placeholder for ${actionType}. Returning 0.`);
             updateActionStatus(actionType, { lastRecordedTimestamp: 0 });


        } catch (error: any) {
            console.error(`Error fetching last timestamp for ${actionType}:`, error);
            toast.error(`Failed to fetch status for ${actionType}: ${error.message}`);
            // Optionally update state with error: updateActionStatus(actionType, { verifyError: `Failed to fetch status: ${error.message}` });
        }
    }, [client, account?.address, userActionsPackageId]);

    // Fetch timestamps on initial load / account change
    useEffect(() => {
        if (client && account?.address) {
            fetchLastActionTimestamp(ACTION_TYPE_TEMP);
            fetchLastActionTimestamp(ACTION_TYPE_TRANSPORT);
        }
    }, [client, account?.address, fetchLastActionTimestamp]);

    // --- Status Polling Logic ---

    const stopStatusPolling = useCallback((actionType: string) => {
        setActionStatuses(prev => {
            const status = prev[actionType];
            if (status?.pollingIntervalId) {
                clearInterval(status.pollingIntervalId);
                console.log(`Stopped polling for ${actionType}`);
                return { ...prev, [actionType]: { ...status, pollingIntervalId: null } };
            }
            return prev;
        });
    }, []);

     const checkStatus = useCallback(async (actionType: string, validationId: string) => {
        console.log(`Checking status for ${actionType} (${validationId})...`);
        try {
            const response = await fetch(`${ATTESTATION_PROVIDER_API_URL}/api/v1/validation-result/${validationId}`);
             if (!response.ok) {
                 if (response.status === 404) {
                     console.log(`Validation record ${validationId} not found yet.`);
                     updateActionStatus(actionType, { currentStatus: "Provider processing request..." });
                     return;
                 }
                 const errorData = await response.json().catch(() => ({}));
                 throw new Error(errorData.error || `API Error: ${response.statusText}`);
             }
            const data = await response.json();
            console.log(`Status for ${validationId}:`, data); // Log the full data

            let statusMessage = `Status: ${data.status}`;
             let errorMessage = data.errorMessage || null; // Explicitly handle error message

             if (errorMessage) {
                 statusMessage += ` - ${errorMessage}`;
             }

             updateActionStatus(actionType, {
                 currentStatus: statusMessage,
                 backendStatus: data.status,
                 // Store necessary data for claim ONLY when complete
                 verificationData: data.status === 'complete' ? data.verificationData : null,
                 verifyError: null // Clear previous errors if we get a valid status update
             });


            // Handle final states
            if (data.status === 'complete') {
                console.log(`Verification complete for ${validationId}. Enabling claim.`);
                updateActionStatus(actionType, {
                    canClaim: true,
                    verifySuccessMessage: "Verification complete! Ready to claim NFT.",
                    currentStatus: "Complete! Ready to claim.",
                    verifyError: null, // Ensure error is cleared on success
                });
                stopStatusPolling(actionType);
                // Fetch the latest timestamp AFTER verification is complete
                await fetchLastActionTimestamp(actionType);
            } else if (data.status === 'error_processing' || data.status === 'failed') {
                console.error(`Processing error/failure for ${validationId}:`, errorMessage);
                updateActionStatus(actionType, {
                    verifyError: `Verification failed: ${errorMessage || 'Provider reported failure.'}`,
                    currentStatus: `Failed: ${errorMessage || 'Provider reported failure.'}`,
                    canClaim: false,
                    verificationData: null, // Clear verification data on failure
                });
                stopStatusPolling(actionType);
            }
             // Implicitly keep polling for 'pending_verification', 'verified', 'pending_fdc', etc.

        } catch (error: any) {
            console.error(`Error checking status for ${validationId}:`, error);
             // Update status with fetch error, clear verification data
            updateActionStatus(actionType, {
                verifyError: `Failed to check status: ${error.message}`,
                currentStatus: `Error checking status: ${error.message}`,
                 verificationData: null,
             });
             stopStatusPolling(actionType); // Stop polling on fetch error
        }
    }, [stopStatusPolling, fetchLastActionTimestamp]); // Add fetchLastActionTimestamp dependency


    const startStatusPolling = useCallback((actionType: string, validationId: string) => {
        stopStatusPolling(actionType); // Ensure no duplicate intervals
        console.log(`Starting status polling for ${actionType} (${validationId})`);
        const intervalId = setInterval(() => {
            // Need to get latest validationId in case it changes, though unlikely here
            setActionStatuses(prev => {
                 const currentValidationId = prev[actionType]?.validationId;
                 if (currentValidationId) {
                     checkStatus(actionType, currentValidationId);
                 } else {
                     console.warn(`Polling stopped for ${actionType}: validationId missing.`);
                      clearInterval(intervalId); // Stop if ID somehow got cleared
                 }
                return prev; // No state change needed here
            });
        }, 5000); // Poll every 5 seconds

        updateActionStatus(actionType, {
            pollingIntervalId: intervalId,
            currentStatus: "Polling provider for status updates..." // Initial status
        });
    }, [checkStatus, stopStatusPolling]);

    // Cleanup polling
    useEffect(() => {
        return () => {
            Object.keys(actionStatuses).forEach(actionType => {
                const intervalId = actionStatuses[actionType]?.pollingIntervalId;
                if (intervalId) {
                    clearInterval(intervalId);
                }
            });
        };
    }, [actionStatuses]); // Rerun if actionStatuses object reference changes (might be frequent) - consider optimizing dependencies if needed


    // --- File Handling (Mostly unchanged) ---
    const handleFileChange = (actionType: string, event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            updateActionStatus(actionType, {
                selectedFile: file,
                selectedFileName: file.name,
                verifyError: null, // Clear errors on new file select
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
                    resolve(reader.result.split(',')[1]); // Get Base64 part
                } else {
                    reject(new Error("Failed to read file as Base64 string"));
                }
            };
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(file);
        });
    };


    // --- Submit Proofs to Attestation Provider ---
    const handleSubmitProofs = async (actionType: string) => {
        if (!account?.address) {
             toast.error("Please connect your wallet first.");
             return;
        }
        const status = actionStatuses[actionType];
        if (!status.selectedFile) {
             toast.error("Please select a file to upload.");
             return;
        }

        updateActionStatus(actionType, {
            isVerifying: true,
            verifyError: null,
            verifySuccessMessage: null,
            currentStatus: "Uploading proof...",
            canClaim: false,
            verificationData: null, // Clear previous data
        });

        try {
             updateActionStatus(actionType, { isReadingFile: true });
             const fileBase64 = await readFileAsBase64(status.selectedFile);
             updateActionStatus(actionType, { isReadingFile: false, currentStatus: "Submitting to provider..." });

             const response = await fetch(`${ATTESTATION_PROVIDER_API_URL}/api/v1/validate-action`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userAddress: account.address, // Use connected IOTA address
                    actionType: actionType,
                    proofData: fileBase64, // Send base64 encoded file data
                    fileName: status.selectedFileName
                }),
            });

             const data = await response.json();

             if (!response.ok) {
                 throw new Error(data.error || `Verification request failed: ${response.statusText}`);
             }

             if (!data.validationId) {
                 throw new Error("Provider did not return a validation ID.");
             }

             console.log(`Verification request submitted. Validation ID: ${data.validationId}`);
             toast.success("Proof submitted! Waiting for verification...");
             updateActionStatus(actionType, {
                 isVerifying: false, // Upload complete, now polling
                 validationId: data.validationId,
                 verifyError: null,
             });
             // Start polling for status updates
             startStatusPolling(actionType, data.validationId);

        } catch (error: any) {
             console.error("Error submitting proofs:", error);
             updateActionStatus(actionType, {
                 isVerifying: false,
                 isReadingFile: false,
                 verifyError: `Submission failed: ${error.message}`,
                 currentStatus: `Error: ${error.message}`
             });
        }
    };


    // --- Handle NFT Claim ---
    const handleClaim = useCallback(async (actionType: string) => {
        if (!client || !account?.address || !nftPackageId) {
            toast.error("Client, account, or NFT package config missing.");
            return;
        }
        const status = actionStatuses[actionType];
        if (!status.canClaim || !status.validationId || !status.verificationData) {
            toast.warning("Not ready to claim or missing verification data.");
            return;
        }
         if (isTxPending) return; // Prevent concurrent claims

        updateActionStatus(actionType, {
            isClaiming: true,
            claimError: null,
            claimSuccessTx: null,
        });
        toast.info(`Claiming NFT for ${actionType}...`);

        try {
            const tx = new Transaction();
            tx.setGasBudget(100_000_000); // Adjust gas budget

            // --- Adapt moveCall based on your IOTA NFT claim function ---
            let targetFunction = '';
            if (actionType === ACTION_TYPE_TEMP) {
                targetFunction = `${nftPackageId}::temp_nft::claim`; // Example
            } else if (actionType === ACTION_TYPE_TRANSPORT) {
                 targetFunction = `${nftPackageId}::transport_nft::claim`; // Example
            } else {
                 throw new Error(`Unknown action type for claim: ${actionType}`);
            }

             // Prepare arguments based on what the Move contract expects
             // This likely includes the verification data received from the provider
             // Example: claim(recipient: address, verification_id: vector<u8>, timestamp: u64, signature: vector<u8>)
             const { timestamp, signature, /* other needed fields */ } = status.verificationData;
             // Ensure data types match Move contract (e.g., convert timestamp, encode strings/signatures)
             const verificationIdBytes = new TextEncoder().encode(status.validationId); // Assuming ID is string
             const signatureBytes = Buffer.from(signature, 'hex'); // Assuming signature is hex string

            tx.moveCall({
                target: targetFunction,
                arguments: [
                    // Arguments MUST match the Move function signature
                     tx.pure.address(account.address),          // recipient
                     tx.pure(Array.from(verificationIdBytes)), // verification_id (vector<u8>)
                     tx.pure.u64(timestamp),                    // timestamp (u64) - ensure it's a compatible number/bigint
                     tx.pure(Array.from(signatureBytes)),      // signature (vector<u8>)
                     // Add other arguments from status.verificationData if needed
                ],
                 // typeArguments: []
            });
            // --- End adaptation section ---

             console.log("Constructed Claim Tx:", JSON.stringify((tx as any).raw || tx));

            signAndExecuteTransaction(
                { transaction: tx },
                {
                    onSuccess: ({ digest }) => {
                        toast.success(`Claim transaction submitted: ${digest}.`);
                        // Don't need polling here if we trust the success callback implies acceptance
                        // Optionally, could still poll getTransaction for finality confirmation
                        updateActionStatus(actionType, {
                            isClaiming: false,
                            claimSuccessTx: digest,
                            canClaim: false, // Prevent double claim
                            verifySuccessMessage: "Claim successful!", // Update message
                            currentStatus: "NFT Claimed!",
                             verificationData: null, // Clear verification data after successful claim
                         });
                         setShowConfetti(true);
                         setTimeout(() => setShowConfetti(false), 5000); // Confetti for 5s
                         // Fetch latest timestamp after successful claim
                         fetchLastActionTimestamp(actionType);
                    },
                    onError: (error: any) => {
                        console.error('Claim transaction failed:', error);
                        toast.error(`Claim failed: ${error.message || 'Unknown error'}`);
                        updateActionStatus(actionType, {
                            isClaiming: false,
                            claimError: `Claim failed: ${error.message || 'Unknown error'}`,
                        });
                    },
                }
            );
        } catch (error: any) {
            console.error('Error constructing claim transaction:', error);
            toast.error(`Claim construction failed: ${error.message || 'Unknown error'}`);
             updateActionStatus(actionType, { isClaiming: false, claimError: `Claim construction failed: ${error.message}` });
        }
    }, [client, account?.address, nftPackageId, actionStatuses, signAndExecuteTransaction, isTxPending, fetchLastActionTimestamp]); // Add fetchLastActionTimestamp


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
                     <CardDescription className="text-xs pt-1">Last Recorded: {lastActionDate}</CardDescription>
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
                                 disabled={status.isVerifying || status.isReadingFile || status.pollingIntervalId !== null}
                             />
                             {status.selectedFileName && !status.isReadingFile && (
                                 <p className="text-xs text-muted-foreground">Selected: {status.selectedFileName}</p>
                             )}
                             {status.isReadingFile && (
                                  <p className="text-xs text-muted-foreground flex items-center"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> Reading file...</p>
                             )}
                              {status.imagePreviewUrl && (
                                <img src={status.imagePreviewUrl} alt="Preview" className="mt-2 max-h-40 rounded border" />
                             )}
                         </div>
                     )}

                     {/* Status Display Area */}
                     {status.currentStatus && !status.verifyError && !status.verifySuccessMessage && (
                          <Alert variant="default">
                             <Loader2 className="h-4 w-4 animate-spin" />
                             <AlertDescription>{status.currentStatus}</AlertDescription>
                         </Alert>
                     )}
                     {status.verifyError && (
                         <Alert variant="destructive">
                             <XCircle className="h-4 w-4" />
                             <AlertTitle>Verification Error</AlertTitle>
                             <AlertDescription>{status.verifyError}</AlertDescription>
                         </Alert>
                     )}
                     {status.verifySuccessMessage && (
                         <Alert variant="success">
                             <CheckCircle className="h-4 w-4" />
                             <AlertTitle>Verification Success</AlertTitle>
                             <AlertDescription>{status.verifySuccessMessage}</AlertDescription>
                         </Alert>
                     )}
                     {status.claimError && (
                         <Alert variant="destructive">
                              <XCircle className="h-4 w-4" />
                             <AlertTitle>Claim Error</AlertTitle>
                             <AlertDescription>{status.claimError}</AlertDescription>
                         </Alert>
                     )}
                     {status.claimSuccessTx && (
                         <Alert variant="success">
                              <CheckCircle className="h-4 w-4" />
                             <AlertTitle>Claim Successful!</AlertTitle>
                             <AlertDescription>
                                 Transaction Digest:
                                 <a
                                      href={`${client?.network?.explorerUrl}/transaction/${status.claimSuccessTx}`} // Adjust explorer URL based on client network info
                                     target="_blank"
                                     rel="noopener noreferrer"
                                     className="ml-1 underline break-all"
                                     title={status.claimSuccessTx}
                                 >
                                      {status.claimSuccessTx.substring(0, 10)}...
                                 </a>
                             </AlertDescription>
                         </Alert>
                     )}

                </CardContent>
                <CardFooter>
                     {isTransport ? (
                         // Button to submit proofs for transport
                         <Button
                             onClick={() => handleSubmitProofs(actionType)}
                             disabled={!status.selectedFile || status.isVerifying || status.isReadingFile || status.pollingIntervalId !== null || !account}
                         >
                             {(status.isVerifying || status.isReadingFile) ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
                             {status.isReadingFile ? 'Reading...' : status.isVerifying ? 'Submitting...' : 'Verify & Submit Proof'}
                         </Button>
                     ) : (
                         // Button to directly verify for Temp (assuming no file needed)
                         // TODO: Implement handleVerify for non-file actions if needed
                         <Button disabled={true}>Verify {title} (Not Implemented)</Button>
                     )}

                     {/* Claim Button - Enabled only when verification is complete */}
                     <Button
                         onClick={() => handleClaim(actionType)}
                         disabled={!status.canClaim || status.isClaiming || isTxPending || !!status.claimSuccessTx}
                         className="ml-auto" // Push claim button to the right
                     >
                         {(status.isClaiming || isTxPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                         {status.claimSuccessTx ? 'NFT Claimed' : status.isClaiming ? 'Claiming...' : 'Claim NFT'}
                     </Button>
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
                         "Upload a screenshot from your mobility app (e.g., Kakao T) showing sustainable transport usage (bike, walk, public transport) to claim NFT rewards based on distance/activity."
                     )}
                 </div>
             )}
        </div>
    );
}