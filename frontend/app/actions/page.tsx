'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useWatchContractEvent } from 'wagmi';
import { flareTestnet } from 'wagmi/chains';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle, XCircle, Upload } from "lucide-react";
import { 
    USER_ACTIONS_ADDRESS,
    CARBON_CREDIT_NFT_ADDRESS,
    USER_ACTIONS_ABI,
    CLAIM_TRANSPORT_NFT_ABI
} from '@/config/contracts';
import { keccak256, toHex, decodeEventLog, type Address, type Hex } from 'viem';
import Confetti from 'react-confetti';

// Constants for action types
const ACTION_TYPE_TEMP = "TEMP_OVER_15_SEOUL";
const ACTION_TYPE_TRANSPORT = "SUSTAINABLE_TRANSPORT_KM";
const ACTION_TYPE_TEMP_B32 = keccak256(toHex(ACTION_TYPE_TEMP));
const ACTION_TYPE_TRANSPORT_B32 = keccak256(toHex(ACTION_TYPE_TRANSPORT));

const ATTESTATION_PROVIDER_API_URL = process.env.NEXT_PUBLIC_ATTESTATION_PROVIDER_URL || 'http://localhost:3001';

interface ActionStatus {
    lastRecordedTimestamp: number;
    isVerifying: boolean;
    verifyError: string | null;
    verifySuccessMessage: string | null;
    isClaiming: boolean;
    claimError: string | null;
    claimSuccessTx: string | null;
    canClaim: boolean;
    // --- New state for file handling ---
    selectedFile: File | null;
    selectedFileName: string;
    isReadingFile: boolean;
    imagePreviewUrl: string | null;
    // --- New state for FDC flow ---
    validationId: string | null; // Store the ID received from the provider
    pollingIntervalId: NodeJS.Timeout | null; // To manage status polling
    currentStatus: string | null; // Display current status from provider
    backendStatus: string | null; // Store the raw status identifier from backend
}

export default function ActionsPage() {
    const { address: userAddress, isConnected } = useAccount();
    const [showConfetti, setShowConfetti] = useState(false);

    // --- State Management for Actions --- 
    const [actionStatuses, setActionStatuses] = useState<{
        [key: string]: ActionStatus
    }>(() => ({
        [ACTION_TYPE_TEMP]: { 
            lastRecordedTimestamp: 0, isVerifying: false, verifyError: null, verifySuccessMessage: null, 
            isClaiming: false, claimError: null, claimSuccessTx: null, canClaim: false,
            selectedFile: null, selectedFileName: '', isReadingFile: false, imagePreviewUrl: null,
            validationId: null, pollingIntervalId: null, currentStatus: null,
            backendStatus: null
        },
        [ACTION_TYPE_TRANSPORT]: { 
            lastRecordedTimestamp: 0, isVerifying: false, verifyError: null, verifySuccessMessage: null, 
            isClaiming: false, claimError: null, claimSuccessTx: null, canClaim: false,
            selectedFile: null, selectedFileName: '', isReadingFile: false, imagePreviewUrl: null,
            validationId: null, pollingIntervalId: null, currentStatus: null,
            backendStatus: null
        },
    }));

    const updateActionStatus = (actionType: string, updates: Partial<ActionStatus>) => {
        setActionStatuses(prev => ({
            ...prev,
            [actionType]: { ...prev[actionType], ...updates }
        }));
    };

    // --- Read Last Action Timestamps (Get refetch function) --- 
    const { data: lastTempTimestampData, refetch: refetchTempTimestamp } = useReadContract({
        address: USER_ACTIONS_ADDRESS,
        abi: USER_ACTIONS_ABI,
        functionName: 'lastActionTimestamp',
        args: [userAddress!, ACTION_TYPE_TEMP_B32],
        query: { enabled: !!userAddress },
    });
    const { data: lastTransportTimestampData, refetch: refetchTransportTimestamp } = useReadContract({
        address: USER_ACTIONS_ADDRESS,
        abi: USER_ACTIONS_ABI,
        functionName: 'lastActionTimestamp',
        args: [userAddress!, ACTION_TYPE_TRANSPORT_B32],
        query: { enabled: !!userAddress },
    });

    // --- Status Polling Logic ---

    const stopStatusPolling = useCallback((actionType: string) => {
        // Use a functional update to safely access the latest state
        setActionStatuses(prev => {
            const status = prev[actionType];
            if (status?.pollingIntervalId) {
                clearInterval(status.pollingIntervalId);
                console.log(`Stopped polling for ${actionType}`);
                // Return the updated state slice
                return {
                    ...prev,
                    [actionType]: { ...status, pollingIntervalId: null }
                };
            }
            // Return previous state if no interval found
            return prev; 
        });
    }, []); // No dependencies needed for this pattern

    const checkStatus = useCallback(async (actionType: string, validationId: string) => {
        console.log(`Checking status for ${actionType} (${validationId})...`);
        try {
            const response = await fetch(`${ATTESTATION_PROVIDER_API_URL}/api/v1/validation-result/${validationId}`);
            if (!response.ok) {
                if (response.status === 404) {
                    console.log(`Validation record ${validationId} not found yet, continuing poll.`);
                    updateActionStatus(actionType, { currentStatus: "Provider processing request..." });
                    return; 
                }
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error || `Failed to fetch status: ${response.statusText}`);
            }

            const data = await response.json();
            console.log(`Received status update for ${validationId}:`, data.status);

            let statusMessage = `Status: ${data.status}`;
            if (data.errorMessage) {
                statusMessage += ` - ${data.errorMessage}`;
            }
            updateActionStatus(actionType, { 
                currentStatus: statusMessage, 
                backendStatus: data.status 
            });

            // Handle final states
            if (data.status === 'complete') {
                console.log(`Verification complete for ${validationId}. Enabling claim and refetching timestamp.`);
                updateActionStatus(actionType, {
                    canClaim: true,
                    verifySuccessMessage: "Verification process complete! Ready to claim.",
                    currentStatus: "Complete! Ready to claim.",
                    verifyError: null,
                });
                stopStatusPolling(actionType); // Stop polling on success

                // *** EXPLICITLY REFETCH TIMESTAMP ***
                if (actionType === ACTION_TYPE_TRANSPORT) {
                    console.log("Refetching transport timestamp...");
                    await refetchTransportTimestamp(); 
                } else if (actionType === ACTION_TYPE_TEMP) {
                    // Add refetch for temp if needed later
                    // await refetchTempTimestamp(); 
                }
            } else if (data.status === 'error_processing' || data.status === 'failed') {
                 console.error(`Processing error/failure for ${validationId}:`, data.errorMessage);
                 updateActionStatus(actionType, {
                     verifyError: `Verification failed: ${data.errorMessage || 'Provider reported failure.'}`,
                     currentStatus: `Failed: ${data.errorMessage || 'Provider reported failure.'}`,
                     canClaim: false,
                 });
                stopStatusPolling(actionType); 
            }
            // Keep polling for 'verified' or 'pending_fdc'

        } catch (error: any) {
            console.error(`Error checking status for ${validationId}:`, error);
            updateActionStatus(actionType, { 
                verifyError: `Failed to check status: ${error.message}`,
                currentStatus: `Error checking status: ${error.message}`
            });
            stopStatusPolling(actionType); // Stop polling on fetch error
        }
    // Add refetch functions to dependencies
    }, [stopStatusPolling, refetchTransportTimestamp, refetchTempTimestamp]); 

    const startStatusPolling = useCallback((actionType: string, validationId: string) => {
        stopStatusPolling(actionType);
        console.log(`Starting status polling loop for ${actionType} (${validationId})`);
        // Don't call checkStatus immediately, let the interval handle the first check
        // checkStatus(actionType, validationId); 

        const intervalId = setInterval(() => {
            console.log(`Polling interval fired for ${actionType}, validationId: ${validationId}. Calling checkStatus...`);
            // Access validationId via functional update in updateActionStatus if needed
            // For simplicity, assume validationId remains stable during polling here
             checkStatus(actionType, validationId); 
        }, 5000); // Poll every 5 seconds

        updateActionStatus(actionType, { 
            pollingIntervalId: intervalId,
            // Set an initial polling status message
            currentStatus: "Polling provider for status updates..." 
        });
    }, [checkStatus, stopStatusPolling]); // checkStatus now includes refetch dependencies

    // --- Cleanup polling intervals on unmount ---
    useEffect(() => {
        return () => {
            Object.keys(actionStatuses).forEach(stopStatusPolling);
        };
    }, [stopStatusPolling]); 

    // Update state when timestamps are fetched/refetched
    useEffect(() => {
        if (lastTempTimestampData !== undefined) {
            console.log(`Updating Temp Timestamp from hook: ${Number(lastTempTimestampData)}`);
            updateActionStatus(ACTION_TYPE_TEMP, { lastRecordedTimestamp: Number(lastTempTimestampData) });
        }
    }, [lastTempTimestampData]);

    useEffect(() => {
        if (lastTransportTimestampData !== undefined) {
             console.log(`Updating Transport Timestamp from hook: ${Number(lastTransportTimestampData)}`);
            updateActionStatus(ACTION_TYPE_TRANSPORT, { lastRecordedTimestamp: Number(lastTransportTimestampData) });
        }
    }, [lastTransportTimestampData]);

    // --- Handle Verification Requests --- 
    const handleVerify = async (actionType: string) => {
        if (!userAddress) return;

        updateActionStatus(actionType, { 
            isVerifying: true, 
            verifyError: null, 
            verifySuccessMessage: null, 
            claimError: null,
            claimSuccessTx: null, 
            canClaim: false, 
            validationId: null, 
            currentStatus: 'Initiating verification...' 
        });

        const status = actionStatuses[actionType];
        let requestBody: any = { userAddress, actionType };

        if (actionType === ACTION_TYPE_TRANSPORT) {
            if (!status.selectedFile) {
                 updateActionStatus(actionType, { isVerifying: false, verifyError: "Please select a screenshot file first." });
                 return;
            }
            updateActionStatus(actionType, { isReadingFile: true });
            try {
                const base64String = await readFileAsBase64(status.selectedFile);
                requestBody.imageBase64 = base64String; 
            } catch (error) {
                console.error("Error reading file:", error);
                updateActionStatus(actionType, { isVerifying: false, isReadingFile: false, verifyError: "Failed to read the selected file." });
                return;
            } finally {
                 updateActionStatus(actionType, { isReadingFile: false });
            }
        }

        try {
            console.log("Sending verification request to Attestation Provider...");
            const response = await fetch(`${ATTESTATION_PROVIDER_API_URL}/request-attestation`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestBody)
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || `Verification request failed: ${response.statusText}`);
            if (!data.validationId) throw new Error("Attestation provider did not return a validation ID.");
            
            console.log("Verification initiated response:", data);
            updateActionStatus(actionType, { 
                validationId: data.validationId,
                currentStatus: "Verification initiated. Waiting for FDC processing...", 
                verifySuccessMessage: null, 
                verifyError: null 
            });
            startStatusPolling(actionType, data.validationId); 
            
        } catch (error: any) {
             console.error("Verification error:", error);
             stopStatusPolling(actionType); 
             updateActionStatus(actionType, { verifyError: error.message || "An unknown error occurred during verification." });
        } finally {
            updateActionStatus(actionType, { isVerifying: false });
        }
    };

    // --- Listen for ActionRecorded Event --- 
    useWatchContractEvent({
        address: USER_ACTIONS_ADDRESS,
        abi: USER_ACTIONS_ABI,
        eventName: 'ActionRecorded',
        onLogs(logs) {
            console.log('ActionRecorded event logs received:', logs);
            logs.forEach(log => {
                try {
                    const decodedLog = decodeEventLog({
                        abi: USER_ACTIONS_ABI, data: log.data, topics: log.topics, eventName: 'ActionRecorded'
                    });

                    if (!decodedLog.args || typeof decodedLog.args !== 'object' || Array.isArray(decodedLog.args) ||
                        !('user' in decodedLog.args) || !('actionType' in decodedLog.args) || !('timestamp' in decodedLog.args)) {
                        console.error("Decoded log args invalid:", decodedLog.args); return; 
                    }
                    
                    const { user, actionType: eventActionTypeB32, timestamp } = decodedLog.args as { user: Address, actionType: Hex, timestamp: bigint };
                                        
                    if (user === userAddress) {
                         const actionType = Object.keys(actionStatuses).find(key => 
                            (key === ACTION_TYPE_TEMP && eventActionTypeB32 === ACTION_TYPE_TEMP_B32) ||
                            (key === ACTION_TYPE_TRANSPORT && eventActionTypeB32 === ACTION_TYPE_TRANSPORT_B32)
                        );

                        if (actionType) {
                            console.log(`ActionRecorded event detected for ${actionType}, user ${user}. Updating timestamp: ${Number(timestamp)}`);
                            updateActionStatus(actionType, {
                                lastRecordedTimestamp: Number(timestamp),
                                // Maybe update canClaim here too as a fallback? 
                                // canClaim: true, 
                                // verifySuccessMessage: `Action successfully recorded via event listener!` // Optional message
                            });
                            // Don't necessarily stop polling here, let checkStatus confirm 'complete' from provider
                        }
                    }
                } catch (error) {
                    console.error("Failed to decode ActionRecorded event log:", error, log);
                }
            });
        },
        onError(error) {
            console.error('Error watching ActionRecorded event:', error);
        }
    });

    // --- Handle NFT Claiming --- 
    const { data: claimTempHash, writeContractAsync: claimTempNFTAsync, isPending: isClaimingTemp } = useWriteContract();
    const { data: claimTransportHash, writeContractAsync: claimTransportNFTAsync, isPending: isClaimingTransport } = useWriteContract();

    const handleClaim = async (actionType: string) => {
        if (!userAddress) return;
        updateActionStatus(actionType, { isClaiming: true, claimError: null, claimSuccessTx: null });

        let claimFunctionName: 'claimTemperatureNFT' | 'claimTransportNFT';
        let writeAsyncFunction: typeof claimTempNFTAsync | typeof claimTransportNFTAsync;
        let abiToUse: typeof USER_ACTIONS_ABI | typeof CLAIM_TRANSPORT_NFT_ABI;
        
        if (actionType === ACTION_TYPE_TEMP) {
            claimFunctionName = 'claimTemperatureNFT';
            writeAsyncFunction = claimTempNFTAsync;
            abiToUse = USER_ACTIONS_ABI; // Assume full ABI needed? Needs verification
            console.warn("Claiming Temp NFT requires the full CarbonCreditNFT ABI - ensure CLAIM_TRANSPORT_NFT_ABI is appropriate or update it.");
             updateActionStatus(actionType, { claimError: "Temp claim ABI needs confirmation.", isClaiming: false });
             return; // Temporarily disable temp claim until ABI is confirmed
        } else if (actionType === ACTION_TYPE_TRANSPORT) {
            claimFunctionName = 'claimTransportNFT';
             writeAsyncFunction = claimTransportNFTAsync;
             abiToUse = CLAIM_TRANSPORT_NFT_ABI; // Use specific ABI for transport claim
        } else {
            updateActionStatus(actionType, { claimError: "Invalid action type for claiming", isClaiming: false });
            return;
        }

        try {
            const hash = await writeAsyncFunction({
                address: CARBON_CREDIT_NFT_ADDRESS,
                abi: abiToUse,
                functionName: claimFunctionName,
                args: [] // Assuming no args needed for claim functions
            });
            console.log(`Claim transaction sent for ${actionType}:`, hash);
            updateActionStatus(actionType, { claimSuccessTx: hash });
        } catch (error: any) {
            console.error(`Claim error for ${actionType}:`, error);
            const shortMessage = error.shortMessage || error.message || "Claiming failed.";
            updateActionStatus(actionType, { claimError: shortMessage, isClaiming: false });
            toast.error("Claim Error ", { description: shortMessage });
        } 
    };

    // --- Monitor Claim Transaction Results --- 
    const { isLoading: isConfirmingTemp, isSuccess: isConfirmedTemp, isError: isConfirmErrorTemp } = useWaitForTransactionReceipt({ hash: claimTempHash });
    const { isLoading: isConfirmingTransport, isSuccess: isConfirmedTransport, isError: isConfirmErrorTransport } = useWaitForTransactionReceipt({ hash: claimTransportHash });
    
    // Temp Claim Confirmation Effect
    useEffect(() => {
        if (isConfirmingTemp) updateActionStatus(ACTION_TYPE_TEMP, { isClaiming: true });
        if (isConfirmedTemp) {
             updateActionStatus(ACTION_TYPE_TEMP, { isClaiming: false, canClaim: false, claimError: null, verifySuccessMessage: null });
             setShowConfetti(true);
             toast.success("Success! ", { description: "Temperature NFT Claimed Successfully!" });
             setTimeout(() => setShowConfetti(false), 5000);
        }
        if (isConfirmErrorTemp) {
             updateActionStatus(ACTION_TYPE_TEMP, { isClaiming: false, claimError: "Transaction failed during confirmation." });
        }
    }, [isConfirmingTemp, isConfirmedTemp, isConfirmErrorTemp]);

    // Transport Claim Confirmation Effect
    useEffect(() => {
        if (isConfirmingTransport) updateActionStatus(ACTION_TYPE_TRANSPORT, { isClaiming: true });
        if (isConfirmedTransport) {
             updateActionStatus(ACTION_TYPE_TRANSPORT, { isClaiming: false, canClaim: false, claimError: null, verifySuccessMessage: null, selectedFile: null, selectedFileName: '' }); // Reset file state on success
             setShowConfetti(true);
             toast.success("Success! ", { description: "Transport NFT Claimed Successfully!" });
             setTimeout(() => setShowConfetti(false), 5000);
        }
        if (isConfirmErrorTransport) {
             updateActionStatus(ACTION_TYPE_TRANSPORT, { isClaiming: false, claimError: "Transaction failed during confirmation." });
        }
    }, [isConfirmingTransport, isConfirmedTransport, isConfirmErrorTransport]);

    // --- File Handling Logic ---
    const handleFileChange = (actionType: string, event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];

        // Revoke previous URL if it exists
        const currentPreviewUrl = actionStatuses[actionType]?.imagePreviewUrl;
        if (currentPreviewUrl) {
            URL.revokeObjectURL(currentPreviewUrl);
        }

        if (file && file.type.startsWith('image/')) {
            const newPreviewUrl = URL.createObjectURL(file);
            updateActionStatus(actionType, { 
                selectedFile: file, 
                selectedFileName: file.name,
                imagePreviewUrl: newPreviewUrl, // Store new URL
                verifyError: null, 
                verifySuccessMessage: null
             });
        } else {
             // Clear if no file selected or not an image
             updateActionStatus(actionType, { 
                selectedFile: null, 
                selectedFileName: '',
                imagePreviewUrl: null,
                verifyError: file ? "Selected file is not a valid image." : null, // Add error if invalid file type
                verifySuccessMessage: null
             });
        }
    };

    // Effect to revoke object URLs on unmount or when file changes clear it
    useEffect(() => {
        const transportStatus = actionStatuses[ACTION_TYPE_TRANSPORT];
        const urlToRevoke = transportStatus?.imagePreviewUrl;

        // Return a cleanup function
        return () => {
            if (urlToRevoke) {
                console.log("Revoking object URL:", urlToRevoke);
                URL.revokeObjectURL(urlToRevoke);
            }
        };
        // Rerun when the imagePreviewUrl changes for the transport action
    }, [actionStatuses[ACTION_TYPE_TRANSPORT]?.imagePreviewUrl]); 

    const readFileAsBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = (error) => reject(error);
            reader.readAsDataURL(file);
        });
    };

    // --- Handle Proof Submission --- 
    const handleSubmitProofs = async (actionType: string) => {
        const status = actionStatuses[actionType];
        if (!status.validationId) {
            console.error("Cannot submit proofs, validationId is missing.");
            toast.error("Error", { description: "Validation ID is missing, cannot submit proofs." });
            return;
        }

        console.log(`Submitting proofs for ${actionType}, validationId: ${status.validationId}`);
        updateActionStatus(actionType, { 
            isVerifying: true, // Re-use for loading state 
            verifyError: null, 
            verifySuccessMessage: null, 
            currentStatus: "Submitting proofs to UserActions contract..."
        });
        stopStatusPolling(actionType);

        try {
            const response = await fetch(`${ATTESTATION_PROVIDER_API_URL}/submit-proofs/${status.validationId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
            });

            const data = await response.json();

            if (!response.ok) {
                if (response.status === 501) {
                    throw new Error("Proof submission endpoint is not implemented on the provider.");
                } 
                throw new Error(data.error || `Proof submission failed: ${response.statusText}`);
            }

            console.log("Proof submission response:", data);
            updateActionStatus(actionType, { 
                isVerifying: false,
                currentStatus: "Proofs submitted. Checking final status...",
            });
            startStatusPolling(actionType, status.validationId);
            toast.info("Processing", { description: "Proofs submitted, waiting for final confirmation..." });

        } catch (error: any) {
            console.error("Proof submission error:", error);
            const shortMessage = error.message || "An unknown error occurred during proof submission.";
            updateActionStatus(actionType, { 
                isVerifying: false, 
                verifyError: shortMessage,
                currentStatus: `Proof Submission Error: ${shortMessage}`
             });
            toast.error("Error", { description: `Proof submission failed: ${shortMessage}` });
        }
    };

    // --- Render Helper --- 
    const renderActionCard = (actionType: string, title: string, description: string) => {
        const status = actionStatuses[actionType];
        const isProcessing = status.isVerifying || status.isClaiming || status.isReadingFile || status.pollingIntervalId !== null; 
        const isAwaitingProofSubmission = status.backendStatus === 'pending_fdc'; 
        // *** Define explicit boolean for claim button enabled state ***
        const isClaimEnabled = isConnected && status.canClaim && status.lastRecordedTimestamp > 0 && !isProcessing;

        return (
            <Card key={actionType}>
                <CardHeader>
                    <CardTitle>{title}</CardTitle>
                    <CardDescription>{description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {actionType === ACTION_TYPE_TRANSPORT && (
                        <div className="space-y-2">
                             <label htmlFor={`file-upload-${actionType}`} className="text-sm font-medium">Upload Screenshot:</label>
                            <div className="flex items-center space-x-2">
                                <Input 
                                    id={`file-upload-${actionType}`} type="file" accept="image/*" 
                                    onChange={(e) => handleFileChange(actionType, e)}
                                    className="flex-grow file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90 cursor-pointer"
                                    disabled={isProcessing}
                                />
                                {status.selectedFileName && <span className="text-sm text-muted-foreground truncate max-w-[150px]" title={status.selectedFileName}>{status.selectedFileName}</span>}
                            </div>
                        </div>
                    )}

                    {/* Image Preview */} 
                    {actionType === ACTION_TYPE_TRANSPORT && status.imagePreviewUrl && (
                        <div className="my-4 p-2 border rounded-md flex justify-center bg-muted/40">
                            <img 
                                src={status.imagePreviewUrl} 
                                alt="Screenshot preview" 
                                className="max-h-48 max-w-full object-contain rounded-sm"
                            />
                        </div>
                    )}

                    <Button 
                        onClick={() => handleVerify(actionType)} 
                        // Keep existing disable logic for verify button
                        disabled={!isConnected || isProcessing || status.canClaim } 
                        className="w-full"
                    >
                        {(status.isVerifying || status.isReadingFile) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        {status.pollingIntervalId ? 'Checking Status...' : `Verify ${actionType === ACTION_TYPE_TRANSPORT ? (status.selectedFile ? 'Selected Screenshot' : 'Transport') : 'Condition'}`}
                    </Button>

                    {status.pollingIntervalId && status.currentStatus && !status.verifyError && !status.verifySuccessMessage && (
                         <Alert variant="default" className="flex items-center">
                             <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
                    {status.verifySuccessMessage && status.canClaim && (
                         <Alert variant="default">
                            <CheckCircle className="h-4 w-4" />
                            <AlertTitle>Verification Status</AlertTitle>
                            <AlertDescription>{status.verifySuccessMessage}</AlertDescription>
                        </Alert>
                    )}
                    
                    {isAwaitingProofSubmission && (
                         <Button 
                            onClick={() => handleSubmitProofs(actionType)} 
                            disabled={!isConnected || status.isVerifying || status.isClaiming} 
                            className="w-full" variant="secondary"
                         >
                             {status.isVerifying && status.currentStatus?.includes("Submitting proofs") && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} 
                            Check & Submit Proofs
                         </Button>
                    )}

                    <Button 
                        onClick={() => handleClaim(actionType)} 
                        // Use the calculated boolean for disabled state
                        disabled={!isClaimEnabled} 
                        className="w-full" variant="outline"
                    >
                        {status.isClaiming && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Claim {title} NFT
                    </Button>
                    {status.claimError && (
                         <Alert variant="destructive">
                            <XCircle className="h-4 w-4" />
                            <AlertTitle>Claim Error</AlertTitle>
                            <AlertDescription>{status.claimError}</AlertDescription>
                        </Alert>
                    )}
                      {status.claimSuccessTx && !status.isClaiming && !status.claimError && (
                         <Alert variant="default">
                            <CheckCircle className="h-4 w-4" />
                            <AlertTitle>Claim Pending</AlertTitle>
                            <AlertDescription>
                                Transaction submitted: <a href={`${flareTestnet.blockExplorers.default.url}/tx/${status.claimSuccessTx}`} target="_blank" rel="noopener noreferrer" className="underline">View on Explorer</a>
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
                <CardFooter>
                    <p className="text-xs text-muted-foreground">
                        Last Recorded: {status.lastRecordedTimestamp > 0 ? new Date(status.lastRecordedTimestamp * 1000).toLocaleString() : 'Never'}
                    </p>
                    {/* Debug display */}
                    {/* <p className="text-xs text-red-500 ml-4">
                        Debug: canClaim={status.canClaim.toString()}, ts={status.lastRecordedTimestamp}, isProcessing={isProcessing.toString()}, isEnabled={isClaimEnabled.toString()}
                    </p> */}
                </CardFooter>
            </Card>
        );
    }

    return (
        <div className="container mx-auto p-4 md:p-6">
            {showConfetti && <Confetti recycle={false} />}
            <h1 className="text-3xl font-bold mb-6">Verify Environmental Actions</h1>
            <p className="mb-8 text-muted-foreground">Prove your real-world sustainable actions using Flare Time Series Oracle (FTSO) and FDC attestations to claim unique Carbon Credit NFTs.</p>

            {!isConnected && (
                 <Alert variant="default" className="mb-6">
                    <AlertTitle>Wallet Not Connected</AlertTitle>
                    <AlertDescription>Please connect your wallet to verify actions and claim NFTs.</AlertDescription>
                </Alert>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* {renderActionCard(
                    ACTION_TYPE_TEMP, 
                    "Hot Weather Activity", 
                    "Verify if the temperature in Seoul, South Korea is currently above 15°C using OpenWeatherMap data attested via FDC."
                )} */}
                {renderActionCard(
                    ACTION_TYPE_TRANSPORT, 
                    "Sustainable Transport", 
                    "Verify completion of a sustainable transport activity (cycling, walking, running, etc.) by uploading a screenshot from your fitness app (Analyzed by AI Vision)."
                )}
            </div>
        </div>
    );
} 