'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
    useIotaClient,
    useSignAndExecuteTransaction,
    useCurrentAccount,
} from '@iota/dapp-kit';

import type { TransactionId } from '@iota/sdk';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import ListItemDialog from "@/components/marketplace/ListItemDialog";
import Image from "next/image"; // Added for proper image optimization
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription
} from "@/components/ui/dialog";
import { Transaction } from '@iota/iota-sdk/transactions'; // Import Transaction class
import { Buffer } from 'buffer'; // Import Buffer for hex conversion

// Assuming network variables are loaded correctly (e.g., from .env.local)
const nftPackageId = process.env.NEXT_PUBLIC_PACKAGE_ID;
const displayObjectId = process.env.NEXT_PUBLIC_DISPLAY_OBJECT_ID; // Required!
const listingRegistryId = process.env.NEXT_PUBLIC_LISTING_REGISTRY_ID; // Read registry ID

// Placeholder image URLs based on activity type
const CYCLING_IMAGE_URL = "/images/cycling_placeholder.jpg"; // Replace with actual URL or path
const WALKING_IMAGE_URL = "/images/walking_placeholder.jpg"; // Replace with actual URL or path
const DEFAULT_NFT_IMAGE_URL = "/images/default_nft_placeholder.jpg"; // Fallback

// --- IOTA Data Structures ---

// Interface for the actual fields within the CarbonCreditNFT Move struct
interface CarbonCreditNftFields {
    amount_kg_co2e?: string; // SDK often returns u64 as string
    activity_type?: number; // u8
    verification_id?: number[]; // vector<u8> - SDK might represent as array of numbers
    issuance_timestamp_ms?: string; // u64 as string
    // Add other fields if your Move struct has them
}

// Adjusted interface for the content of an NFT object response from getObject
interface NftObjectContent {
    dataType?: 'moveObject';
    type?: string; // e.g., "0xpackage::module::Struct"
    hasPublicTransfer?: boolean;
    fields?: CarbonCreditNftFields;
    // Potentially other fields like version, digest
}

// Structure for the display object data (based on display.move)
interface DisplayObjectData {
    fields?: {
        name?: string;
        description?: string;
        link?: string;
        image_url?: string; // Changed from imageUrl
        // Add other expected fields based on your Move struct
    };
    // Removed version as it's not typically part of the 'fields'
    [key: string]: unknown; // Allow other fields potentially added by Sui/SDK
}

// Combined type for displaying NFTs in the UI
// Uses collection display data + specific NFT data
interface OwnedNftDisplayData {
    id: string; // Object ID
    metadata: {
        name?: string; // From Display object
        description?: string; // From Display object
        imageUrl?: string; // Constructed or from Display object

        // Specific fields from the NFT struct itself
        amount_kg_co2e?: number; // Parsed from string
        activity_type?: number;
        verification_id_hex?: string; // Processed from vector<u8>
        issuedTimestamp?: number; // Parsed from string

        // Keep attributes if needed, but they likely come from Display or are constructed
        attributes?: { trait_type: string; value: any }[];
    };
}

// Type for object info response
interface ObjectInfo {
    data?: NftObjectContent | Record<string, unknown>;
    [key: string]: unknown;
}

// Interface for the fields within the RetirementCertificate Move struct
interface RetirementCertificateFields {
    original_nft_id?: string; // ID
    retirer_address?: string; // address
    retired_amount_kg_co2e?: string; // u64 as string
    original_verification_id?: number[]; // vector<u8>
    retirement_timestamp_ms?: string; // u64 as string
}

// Interface for the content of a fetched RetirementCertificate object
interface CertificateObjectContent {
    dataType?: 'moveObject';
    type?: string; // e.g., "0xPACKAGE::carbon_nft_manager::RetirementCertificate"
    hasPublicTransfer?: boolean; // Should be true based on our implementation (using transfer, not freeze)
    fields?: RetirementCertificateFields;
}

// Combined type for displaying Certificates in the UI
interface OwnedCertificateDisplayData {
    id: string; // Certificate Object ID
    originalNftId?: string;
    retirerAddress?: string;
    retiredAmountKgCo2e?: number; // Parsed from string
    originalVerificationIdHex?: string; // Processed from vector<u8>
    retirementTimestamp?: number; // Parsed from string
    // Add any other processed fields needed for display
}

// --- Component ---

export default function MyAssetsPage() {
    const client = useIotaClient();
    const { mutate: signAndExecuteTransaction, isPending: isTxPending } = useSignAndExecuteTransaction(); // Rename isPending if needed
    const account = useCurrentAccount();

    // Use configured IDs (ensure .env.local is set up and server restarted)
    const carbonNftType = `${nftPackageId}::carbon_nft_manager::CarbonCreditNFT`;

    // State
    const [ownedNfts, setOwnedNfts] = useState<OwnedNftDisplayData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    // State to hold collection display data
    const [collectionDisplayData, setCollectionDisplayData] = useState<DisplayObjectData | null>(null);
    // Removed isDisplayLoading from destructuring since it's unused
    const [, setIsDisplayLoading] = useState(false);

    // Retirement State (keep as is for now)
    const [retiringNftId, setRetiringNftId] = useState<string | null>(null);
    const [retirementTxDigest, setRetirementTxDigest] = useState<TransactionId | undefined>();
    const [isWaitingForRetireConfirm, setIsWaitingForRetireConfirm] = useState(false);

    // Listing State (kept and used with ListItemDialog)
    const [isListDialogOpen, setIsListDialogOpen] = useState(false);
    const [nftToList, setNftToList] = useState<OwnedNftDisplayData | null>(null);

    // Add state for owned certificates
    const [ownedCertificates, setOwnedCertificates] = useState<OwnedCertificateDisplayData[]>([]);

    // --- Data Fetching Logic ---

    useEffect(() => {
        const fetchDisplayObject = async () => {
            if (!client || !displayObjectId) {
                setError("Client or Display Object ID not available.");
                return;
            }
            console.log("Fetching Display object:", displayObjectId);
            setIsDisplayLoading(true);
            setError(null);
            try {
                // Use parameter object with the correct type AND fetch options
                const response = await client.getObject({
                    id: displayObjectId,
                    options: { showContent: true, showType: true } // Request content
                });
                if (response?.data) {
                    const displayDataRaw = response.data as unknown;
                    console.log("Raw Display data fetched:", displayDataRaw);

                    // Try accessing fields directly under content (now that we requested it)
                    const potentialFields = (displayDataRaw as any)?.content?.fields;

                    if (potentialFields && typeof potentialFields === 'object') {
                         setCollectionDisplayData({ fields: potentialFields });
                         console.log("Parsed Display data:", { fields: potentialFields });
                    } else {
                        console.warn("Display object data found, but 'fields' property is missing or not an object:", displayDataRaw);
                        throw new Error("Display object format unexpected.");
                    }
                } else {
                    throw new Error("Display object not found or has no data.");
                }
            } catch (err: unknown) {
                const errorMessage = err instanceof Error ? err.message : String(err);
                console.error("Error fetching Display object:", err);
                setError(`Failed to load collection display info: ${errorMessage}`);
                setCollectionDisplayData(null); // Clear on error
            } finally {
                setIsDisplayLoading(false);
            }
        };

        fetchDisplayObject();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client, displayObjectId]); // Re-fetch if client or ID changes

    // Fetch details for multiple objects
    const fetchObjectsBatch = useCallback(async (objectIds: string[]): Promise<Map<string, ObjectInfo | null>> => {
        const results = new Map<string, ObjectInfo | null>();
        if (!client || objectIds.length === 0) {
            console.log("fetchObjectsBatch: Skipping, client not ready or no object IDs provided.");
            return results;
        }
        console.log("Fetching object details for:", objectIds);

        // Fetch objects sequentially to avoid rate limits or complex batching logic for now
        try {
            for (const id of objectIds) {
                try {
                    // Use parameter object AND request content
                    console.log(`fetchObjectsBatch: Fetching object ${id}`);
                    const response = await client.getObject({
                        id: id,
                        options: { showContent: true, showType: true } // Ensure content is fetched
                    });
                    // Cast to unknown first for safety
                    results.set(id, response as unknown as ObjectInfo || null);
                } catch (individualError: unknown) {
                    console.warn(`Failed to fetch object ${id}:`, individualError);
                    results.set(id, null); // Mark as failed
                }
            }
        } catch (batchError: unknown) { // This catch might be less likely with sequential fetching
            const errorMessage = batchError instanceof Error ? batchError.message : String(batchError);
            console.error("Error during sequential object fetching:", batchError);
            // Ensure all are marked as failed on batch error
            objectIds.forEach(id => { if (!results.has(id)) results.set(id, null); });
            setError(prev => prev ? `${prev}\nFailed to fetch some object details: ${errorMessage}` : `Failed to fetch some object details: ${errorMessage}`);
        }
        return results;
    }, [client]); // Only depends on client

    // Define fetchOwnedNfts outside useEffect, wrapped in useCallback
    const fetchOwnedNfts = useCallback(async () => {
        if (!client || !account || !account.address) {
            // Don't fetch if client or account isn't ready
            // Keep collectionDisplayData check within NFT processing
            setIsLoading(true); // Still set loading true initially
            setError(null);
            setOwnedNfts([]);
            setOwnedCertificates([]); // Clear certificates too
            console.log("fetchOwnedNfts: Skipping fetch, client or account not ready.");
            setIsLoading(false); // Reset loading if skipping
            return;
        }

        console.log("Fetching owned assets for:", account.address);
        setIsLoading(true);
        setError(null);
        setOwnedNfts([]); // Clear previous NFTs
        setOwnedCertificates([]); // Clear previous Certificates

        // --- Define Types ---
        const carbonNftType = `${nftPackageId}::carbon_nft_manager::CarbonCreditNFT`;
        const certificateType = `${nftPackageId}::carbon_nft_manager::RetirementCertificate`; // Define certificate type

        let ownedNftObjectIds: string[] = [];
        let ownedCertObjectIds: string[] = [];

        try {
            // --- Fetch NFT Object IDs ---
            console.log(`Fetching NFTs with type filter: ${carbonNftType}`);
            const nftResponse = await client.getOwnedObjects({
                owner: account.address,
                filter: { StructType: carbonNftType },
                options: { showType: true, showContent: false },
            });
            const nftApiResponse = nftResponse as unknown as { data?: Array<{ data?: { objectId?: string } }> };
            ownedNftObjectIds = (nftApiResponse?.data || []).map(item => item?.data?.objectId).filter(Boolean) as string[];
            console.log(`Found ${ownedNftObjectIds.length} potential NFT objects.`);

            // --- Fetch Certificate Object IDs ---
            console.log(`Fetching Certificates with type filter: ${certificateType}`);
            const certResponse = await client.getOwnedObjects({
                owner: account.address,
                filter: { StructType: certificateType },
                options: { showType: true, showContent: false },
            });
            const certApiResponse = certResponse as unknown as { data?: Array<{ data?: { objectId?: string } }> };
            ownedCertObjectIds = (certApiResponse?.data || []).map(item => item?.data?.objectId).filter(Boolean) as string[];
            console.log(`Found ${ownedCertObjectIds.length} potential Certificate objects.`);

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error("Error fetching owned object IDs:", err);
            setError(`Failed to get list of owned objects: ${errorMessage}`);
            setIsLoading(false);
            return; // Stop execution here
        }

        const allObjectIds = [...ownedNftObjectIds, ...ownedCertObjectIds];

        if (allObjectIds.length === 0) {
            console.log("No owned NFTs or Certificates found.");
            setIsLoading(false);
            return;
        }

        // Fetch full details for all identified objects
        const objectDetailsMap = await fetchObjectsBatch(allObjectIds);
        console.log("Fetched details map for all objects:", objectDetailsMap);

        // Process and filter fetched objects
        const processedNfts: OwnedNftDisplayData[] = [];
        const processedCertificates: OwnedCertificateDisplayData[] = []; // Array for certificates

        for (const [id, objectInfo] of objectDetailsMap.entries()) {
            console.log(`Processing object ID: ${id}`);
            if (!objectInfo?.data) {
                console.warn(`Skipping object ${id} due to missing data.`);
                continue;
            }
            // Log the raw data structure for this specific object
            // console.log(`Raw data for object ${id}:`, JSON.stringify(objectInfo.data, null, 2));

            try {
                const data = objectInfo.data as any; // Cast to any for easier access

                // --- Process based on Type ---
                if (data?.type === carbonNftType) {
                    // --- Process as CarbonCreditNFT ---
                    if (!collectionDisplayData) {
                        console.warn(`Skipping NFT ${id} - collectionDisplayData not ready.`);
                        continue; // Skip if display data isn't loaded yet
                    }
                    const nestedContent = data?.content;
                    if (!nestedContent?.fields) {
                        console.warn(`Skipping NFT ${id} - missing fields information.`);
                        continue;
                    }
                    const fields = nestedContent.fields as CarbonCreditNftFields;

                    const nftData: OwnedNftDisplayData = {
                        id: id,
                        metadata: {
                            name: collectionDisplayData?.fields?.name ?? 'Verified Carbon Credit',
                            description: collectionDisplayData?.fields?.description ?? 'No collection description.',
                            // imageUrl logic removed here, handled in renderNftCard
                            amount_kg_co2e: fields?.amount_kg_co2e ? parseInt(fields.amount_kg_co2e, 10) : undefined,
                            activity_type: fields?.activity_type,
                            verification_id_hex: fields?.verification_id
                                ? (() => { try { return Buffer.from(fields.verification_id!).toString('hex'); } catch(e) { console.error(`Error parsing verification_id for NFT ${id}`, e); return undefined; } })()
                                : undefined,
                            issuedTimestamp: fields?.issuance_timestamp_ms ? parseInt(fields.issuance_timestamp_ms, 10) : undefined,
                            attributes: [], // Placeholder
                        }
                    };
                    processedNfts.push(nftData);

                } else if (data?.type === certificateType) {
                    // --- Process as RetirementCertificate ---
                    const nestedContent = data?.content;
                    if (!nestedContent?.fields) {
                        console.warn(`Skipping Certificate ${id} - missing fields information.`);
                        continue;
                    }
                    const fields = nestedContent.fields as RetirementCertificateFields; // Use correct interface

                    const certData: OwnedCertificateDisplayData = {
                        id: id,
                        originalNftId: fields?.original_nft_id,
                        retirerAddress: fields?.retirer_address,
                        retiredAmountKgCo2e: fields?.retired_amount_kg_co2e ? parseInt(fields.retired_amount_kg_co2e, 10) : undefined,
                        originalVerificationIdHex: fields?.original_verification_id
                            ? (() => { try { return Buffer.from(fields.original_verification_id!).toString('hex'); } catch(e) { console.error(`Error parsing original_verification_id for Cert ${id}`, e); return undefined; } })()
                            : undefined,
                        retirementTimestamp: fields?.retirement_timestamp_ms ? parseInt(fields.retirement_timestamp_ms, 10) : undefined,
                    };
                    processedCertificates.push(certData);

                } else {
                    console.warn(`Skipping object ${id} - unknown type: ${data?.type}`);
                }

            } catch (parseError: unknown) {
                console.error(`Error processing object data for ${id}:`, parseError, objectInfo.data);
            }
        }

        console.log("Processed NFTs:", processedNfts);
        console.log("Processed Certificates:", processedCertificates);
        setOwnedNfts(processedNfts);
        setOwnedCertificates(processedCertificates); // Set certificate state
        setIsLoading(false);

    // Dependencies: Now only depends on client, account, and fetchObjectsBatch callback
    // collectionDisplayData dependency removed as it's checked inside the loop
    }, [client, account, fetchObjectsBatch, nftPackageId, collectionDisplayData]); // Added nftPackageId dependency

    // UseEffect to fetch owned NFTs on mount and when dependencies change
    useEffect(() => {
        fetchOwnedNfts();
    }, [fetchOwnedNfts]); // Now depends on the stable fetchOwnedNfts callback

    // --- Retirement Confirmation Polling ---
    useEffect(() => {
         if (!retirementTxDigest || !isWaitingForRetireConfirm || !client) return;
         console.log(`Polling for retirement tx: ${retirementTxDigest}`);
         const startTime = Date.now();
         const timeoutDuration = 60000; // 60 seconds timeout

         const poll = async () => {
             if (!client || !retirementTxDigest) return; // Ensure client and digest are available
             const currentTime = Date.now();
             if (currentTime - startTime > timeoutDuration) {
                 console.error(`Timeout polling for transaction ${retirementTxDigest}`);
                 toast.error(`Timeout waiting for retirement confirmation for tx: ${retirementTxDigest.substring(0,10)}...`);
                 setIsWaitingForRetireConfirm(false);
                 setRetiringNftId(null);
                 // Don't clear interval here, let the cleanup function handle it
                 return;
             }

             try {
                 // Use parameter object with correct parameter name
                 const txDetails = await client.getTransactionBlock({ 
                    digest: retirementTxDigest,
                    options: { showEffects: true }
                });

                 // Check status based on SDK structure - VERIFY THIS PATH
                 const status = (txDetails as any)?.effects?.status?.status; // Example path, adjust as needed

                 if (status === 'success') {
                     toast.success(`NFT ${retiringNftId?.substring(0,6)}... retired successfully!`);
                     setIsWaitingForRetireConfirm(false);
                     setRetiringNftId(null);
                     fetchOwnedNfts(); // Refetch NFTs after successful retirement
                     // Don't clear interval here, let the cleanup function handle it
                 } else if (status === 'failure') {
                     const errorMsg = (txDetails as any)?.effects?.status?.error || 'Unknown reason';
                     console.error(`Retirement transaction ${retirementTxDigest} failed:`, errorMsg);
                     toast.error(`Retirement failed: ${errorMsg}`);
                     setIsWaitingForRetireConfirm(false);
                     setRetiringNftId(null);
                     // Don't clear interval here, let the cleanup function handle it
                 }
                 // else status is pending, continue polling
             } catch (error: unknown) {
                 // Don't stop polling on temporary network errors, but log them
                 const errorMessage = error instanceof Error ? error.message : String(error);
                 console.warn("Polling error:", errorMessage);
                 // Consider adding logic to stop after too many consecutive errors
             }
         };

         const intervalId = setInterval(poll, 3000); // Poll every 3 seconds

         return () => clearInterval(intervalId); // Cleanup on unmount or dependency change
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [retirementTxDigest, isWaitingForRetireConfirm, client, retiringNftId /* Removed fetchOwnedNfts */]); // fetchOwnedNfts removed to avoid loop, called manually on success


    // --- Actions ---

    // useCallback for handleRetire
    const handleRetire = useCallback(async (nftId: string) => {
        if (!client || !account || !account.address || !nftPackageId) {
            toast.error("Client, account, or Package ID not configured.");
            return;
        }
        if (retiringNftId) return; // Prevent multiple retirements

        setRetiringNftId(nftId);
        setRetirementTxDigest(undefined); // Clear previous digest
        setIsWaitingForRetireConfirm(false); // Reset confirmation state
        toast.info(`Preparing to retire NFT ${nftId.substring(0, 6)}...`);

        try {
            // Construct Transaction object
            const tx = new Transaction();
            tx.setGasBudget(50_000_000); // Example gas budget

            // Define the move call
            tx.moveCall({
                target: `${nftPackageId}::carbon_nft_manager::retire_nft`,
                arguments: [
                    tx.object(nftId) // Pass the NFT ID as an object argument
                ],
                // typeArguments: [], // No type args for retire_nft
            });

            // Sign and execute using the constructed Transaction object
            signAndExecuteTransaction(
                { transaction: tx }, // Pass the Transaction object
                {
                    onSuccess: (result: { digest: TransactionId }) => {
                        console.log("Retirement tx submitted:", result);
                        toast.success(`Retirement transaction submitted: ${result.digest}. Waiting for confirmation...`);
                        setRetirementTxDigest(result.digest);
                        setIsWaitingForRetireConfirm(true); // Start polling
                    },
                    onError: (error: any) => {
                        console.error("Retirement transaction failed:", error);
                        toast.error(`Retirement failed: ${error.message || 'Unknown error'}`);
                        setRetiringNftId(null); // Reset retiring ID on error
                    },
                    // onSettled might be useful for cleanup regardless of success/error
                }
            );

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Error constructing/signing retirement transaction:", error);
            toast.error(`Error: ${errorMessage}`);
            setRetiringNftId(null);
        }
    }, [client, account, nftPackageId, retiringNftId, signAndExecuteTransaction]); // Dependencies for useCallback

     // Handler to open the listing dialog
     const handleList = (nft: OwnedNftDisplayData) => {
        console.log("Opening list dialog for:", nft.id);
        setNftToList(nft);
        setIsListDialogOpen(true);
    };

    // Handler for when listing is complete (called from dialog)
    const handleListingComplete = () => {
        console.log("Listing complete, closing dialog and potentially refreshing");
        setIsListDialogOpen(false);
        setNftToList(null);
        // Optionally trigger a refetch of owned NFTs if listing changes ownership/state immediately
        // fetchOwnedNfts(); // Or just rely on user navigating away/back
    };


    // --- Rendering Logic ---

    // Refactored to use OwnedNftDisplayData
     const renderNftCard = (nft: OwnedNftDisplayData) => (
        <Card key={nft.id} className="flex flex-col">
            <CardHeader>
                <CardTitle className="truncate" title={nft.metadata?.name || 'Unnamed NFT'}>
                    {nft.metadata?.name || 'Unnamed NFT'}
                </CardTitle>
                <CardDescription className="truncate" title={nft.id}>
                     ID: {nft.id.substring(0, 6)}...{nft.id.substring(nft.id.length - 4)}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex-grow">
                {nft.metadata?.activity_type ? (
                    <Image
                        src={nft.metadata.activity_type === 1 ? CYCLING_IMAGE_URL : WALKING_IMAGE_URL}
                        alt={nft.metadata.name || 'NFT Image'}
                        width={300} // Example intrinsic width
                        height={300} // Example intrinsic height
                        onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder-image.png'; }} // Fallback image
                        className="w-full h-48 object-cover rounded"
                        priority={false} // Lazy load images below the fold
                    />
                ) : (
                    <div className="w-full h-48 bg-secondary rounded flex items-center justify-center text-muted-foreground">No Image</div>
                )}
                <div className="mt-4 space-y-1 text-sm">
                     {/* Display NFT specific data */}
                     {nft.metadata?.amount_kg_co2e !== undefined && <p><strong>Amount:</strong> {(nft.metadata.amount_kg_co2e / 1000).toLocaleString()} kg CO₂e</p>}
                     {nft.metadata?.activity_type !== undefined && <p><strong>Transportation:</strong> {nft.metadata.activity_type === 1 ? 'Cycling' : 'Walking'}</p>}
                     {nft.metadata?.issuedTimestamp !== undefined && <p><strong>Issued:</strong> {new Date(nft.metadata.issuedTimestamp).toLocaleString()}</p>}
                     {nft.metadata?.verification_id_hex && <p className="text-xs text-muted-foreground truncate" title={nft.metadata.verification_id_hex}><strong>Verification:</strong> {nft.metadata.verification_id_hex}</p>}
 
                     {/* Render attributes if populated */}
                    {nft.metadata?.attributes && nft.metadata.attributes.length > 0 && (
                        <div className="pt-2">
                            <strong>Attributes:</strong>
                            <ul className="list-disc list-inside ml-4">
                                {nft.metadata.attributes.map((attr: any, index: number) => (
                                    <li key={index}>{attr.trait_type}: {attr.value}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                 </div>
            </CardContent>
            <CardFooter className="flex justify-between">
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleList(nft)}
                    disabled={!!retiringNftId} // Disable if *any* NFT is retiring/pending
                >
                    List for Sale
                </Button>
                <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleRetire(nft.id)}
                    disabled={!!retiringNftId} // Disable if *any* NFT is retiring/pending
                >
                    {retiringNftId === nft.id ? (isWaitingForRetireConfirm ? 'Retiring...' : 'Processing...') : 'Retire'}
                </Button>
            </CardFooter>
        </Card>
    );

    const renderSkeletonCard = (key: number) => (
        <Card key={key}>
            <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-1" />
            </CardHeader>
            <CardContent>
                <Skeleton className="w-full h-48 rounded" />
                <div className="mt-2 space-y-2">
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-4 w-1/4" />
                    <Skeleton className="h-4 w-1/3" />
                    <Skeleton className="h-3 w-full" />
                </div>
            </CardContent>
            <CardFooter className="flex justify-between">
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-9 w-24" />
            </CardFooter>
        </Card>
    );

    // --- NEW: Function to render a Retirement Certificate Card ---
    const renderCertificateCard = (cert: OwnedCertificateDisplayData) => (
        <Card key={cert.id} className="flex flex-col bg-slate-100 dark:bg-slate-800 border-slate-300 dark:border-slate-700">
            <CardHeader>
                <CardTitle className="truncate text-slate-700 dark:text-slate-300" title={`Certificate ${cert.id}`}>
                    Retirement Certificate
                </CardTitle>
                <CardDescription className="truncate text-xs" title={cert.id}>
                     Cert ID: {cert.id.substring(0, 6)}...{cert.id.substring(cert.id.length - 4)}
                </CardDescription>
                 <CardDescription className="truncate text-xs" title={cert.originalNftId}>
                     Original NFT ID: {cert.originalNftId ? `${cert.originalNftId.substring(0, 6)}...${cert.originalNftId.substring(cert.originalNftId.length - 4)}` : 'N/A'}
                </CardDescription>
            </CardHeader>
            <CardContent className="flex-grow">
                {/* No image for certificates, just data */}
                <div className="mt-1 space-y-1 text-sm text-slate-600 dark:text-slate-400">
                     {cert.retiredAmountKgCo2e !== undefined && <p><strong>Amount Retired:</strong> {(cert.retiredAmountKgCo2e / 1000).toLocaleString()} kg CO₂e</p>}
                     {cert.retirementTimestamp !== undefined && <p><strong>Retired On:</strong> {new Date(cert.retirementTimestamp).toLocaleString()}</p>}
                     {cert.originalVerificationIdHex && <p className="text-xs text-muted-foreground truncate" title={cert.originalVerificationIdHex}><strong>Original Verification:</strong> {cert.originalVerificationIdHex}</p>}
                     {/* Optionally display retirer address if needed, though it should be the current user */}
                     {/* {cert.retirerAddress && <p className="text-xs text-muted-foreground truncate" title={cert.retirerAddress}>Retirer: {cert.retirerAddress}</p>} */}
                 </div>
            </CardContent>
             {/* No footer actions needed for certificates */}
             <CardFooter/>
        </Card>
    );

    // Main component return
    return (
        <div className="container mx-auto p-4 space-y-8">
            <div>
                <h1 className="text-3xl font-bold mb-6">My Carbon Credit NFTs</h1>

                {/* Error Display */}
                {error && (
                    <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                        <p><strong>Error:</strong> {error}</p>
                    </div>
                )}

                {/* NFT Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
                     {isLoading && !error // Show skeletons only during initial load and no error
                         ? [...Array(4)].map((_, i) => renderSkeletonCard(i))
                         : ownedNfts.length > 0
                             ? ownedNfts.map(renderNftCard)
                             : !isLoading && !error && // Show only if not loading and no error
                               <p className="col-span-full text-center text-gray-500 mt-8">You do not own any active Carbon Credit NFTs from this collection yet.</p>
                     }
                 </div>
            </div>

             {/* --- NEW: Section for Retired Certificates --- */}
             <hr className="my-8 border-gray-300 dark:border-gray-700"/> {/* Divider */}
             <div>
                <h2 className="text-2xl font-bold mb-6">My Retired Certificates</h2>
                 <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-6">
                      {isLoading && !error // Show skeletons only during initial load and no error
                         ? [...Array(4)].map((_, i) => renderSkeletonCard(i)) // Reuse NFT skeleton for now
                         : ownedCertificates.length > 0
                             ? ownedCertificates.map(renderCertificateCard)
                             : !isLoading && !error && // Show only if not loading and no error
                                <p className="col-span-full text-center text-gray-500 mt-8">You have not retired any Carbon Credit NFTs yet.</p>
                      }
                  </div>
             </div>

             {/* Listing Dialog (keep as is) */}
              {nftToList && nftPackageId && listingRegistryId && (
                 <Dialog open={isListDialogOpen} onOpenChange={setIsListDialogOpen}>
                    <DialogContent>
                         <DialogHeader>
                             <DialogTitle>List NFT for Sale</DialogTitle>
                         </DialogHeader>
                         <ListItemDialog
                             nft={{ id: nftToList.id, metadata: { name: nftToList.metadata?.name } }}
                             onListingComplete={handleListingComplete}
                             marketplacePackageId={nftPackageId} // Use correct variable
                             listingRegistryId={listingRegistryId}
                         />
                    </DialogContent>
                 </Dialog>
             )}
        </div>
    );
}