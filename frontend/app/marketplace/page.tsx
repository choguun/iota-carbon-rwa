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
import Image from "next/image";
import { Transaction } from '@iota/iota-sdk/transactions';
import { Buffer } from 'buffer';

// TODO: Get correct Package IDs from environment variables
const marketplacePackageId = process.env.NEXT_PUBLIC_MARKETPLACE_PACKAGE_ID || 'PLACEHOLDER_MARKETPLACE_PACKAGE_ID';
const nftPackageId = process.env.NEXT_PUBLIC_PACKAGE_ID || 'PLACEHOLDER_NFT_PACKAGE_ID';
const listingRegistryId = process.env.NEXT_PUBLIC_LISTING_REGISTRY_ID || 'PLACEHOLDER_REGISTRY_ID';
const nftDisplayObjectId = process.env.NEXT_PUBLIC_DISPLAY_OBJECT_ID || 'PLACEHOLDER_NFT_DISPLAY_ID';

// --- Data Structures --- //

// Structure matching the fields in the Listing Move struct
interface ListingFields {
    id: string; // UID of the Listing object
    nft_id: string; // ID of the contained CarbonCreditNFT
    // nft: NftObjectContent; // The actual NFT object - fetching separately might be better
    price_micro_iota: string; // u64 as string
    seller: string; // address as string
}

// Structure for the content of a fetched Listing object
interface ListingObjectContent {
    dataType: 'moveObject';
    type: string; // e.g., "0xMARKETPLACE_PACKAGE::marketplace::Listing"
    hasPublicTransfer: boolean;
    fields: ListingFields;
}

// Structure for the CarbonCreditNFT fields (copied from my-assets for now)
interface CarbonCreditNftFields {
    amount_kg_co2e?: string; // SDK often returns u64 as string
    activity_type?: number; // u8
    verification_id?: number[]; // vector<u8> - SDK might represent as array of numbers
    issuance_timestamp_ms?: string; // u64 as string
}

interface NftObjectContent {
    dataType?: 'moveObject';
    type?: string; // e.g., "0xNFT_PACKAGE::carbon_nft_manager::CarbonCreditNFT"
    hasPublicTransfer?: boolean;
    fields?: CarbonCreditNftFields;
}

// Combined data for displaying a listing
interface MarketplaceListingData {
    listingId: string; // ID of the Listing Move object
    nftId: string; // ID of the NFT object
    priceMicroIota: bigint;
    sellerAddress: string;
    nftMetadata?: { // Metadata fetched separately for the NFT
        name?: string;
        description?: string;
        imageUrl?: string;
        amount_kg_co2e?: number;
        activity_type?: number;
        issuedTimestamp?: number;
    };
    fetchError?: string;
}

// Structure for NFT collection display object data (copied from my-assets)
interface DisplayObjectData {
    fields?: {
        name?: string;
        description?: string;
        image_url?: string; // Expecting template like https://.../{id}.png
        // Add other expected fields based on your Display object
    };
    [key: string]: unknown;
}

// --- Component --- //

export default function MarketplacePage() {
    const account = useCurrentAccount();
    const client = useIotaClient();
    const { mutate: signAndExecuteTransaction, isPending: isTxPending } = useSignAndExecuteTransaction();

    const [listings, setListings] = useState<MarketplaceListingData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // State for NFT collection display data
    const [collectionDisplayData, setCollectionDisplayData] = useState<DisplayObjectData | null>(null);

    // State for buy transaction
    const [buyingListingId, setBuyingListingId] = useState<string | null>(null);
    const [buyTxDigest, setBuyTxDigest] = useState<TransactionId | undefined>();
    const [isWaitingForBuyConfirm, setIsWaitingForBuyConfirm] = useState(false);

    // State for cancel transaction
    const [cancellingListingId, setCancellingListingId] = useState<string | null>(null);
    const [cancelTxDigest, setCancelTxDigest] = useState<TransactionId | undefined>();
    const [isWaitingForCancelConfirm, setIsWaitingForCancelConfirm] = useState(false);

    // --- Data Fetching Logic --- //

    // Fetch NFT Collection Display Data (similar to my-assets)
    const fetchDisplayData = useCallback(async () => {
        if (!client || !nftDisplayObjectId || nftDisplayObjectId === 'PLACEHOLDER_NFT_DISPLAY_ID') {
            console.error("NFT Collection Display Object ID not configured.");
            // Don't set top-level error, listings might still load
            return;
        }
        console.log("Fetching NFT Collection Display object:", nftDisplayObjectId);
        try {
            const response = await client.getObject({ id: nftDisplayObjectId });
            const displayDataRaw = response?.data as unknown;

            const potentialFields = (displayDataRaw as any)?.fields;
            if (potentialFields && typeof potentialFields === 'object') {
                setCollectionDisplayData({ fields: potentialFields });
                console.log("Parsed NFT Collection Display data:", { fields: potentialFields });
            } else {
                 console.warn("NFT Display object format unexpected:", displayDataRaw);
                 setCollectionDisplayData(null);
            }
        } catch (err) {
            console.error("Error fetching NFT Collection Display object:", err);
            // Display data is auxiliary, don't block page with error, just log it
            setCollectionDisplayData(null);
        }
    }, [client]);

    useEffect(() => {
        fetchDisplayData();
    }, [fetchDisplayData]);

    // This likely requires a view function in the marketplace contract or querying dynamic fields/events.
    // For now, we'll use a placeholder.
    const fetchListings = useCallback(async () => {
        // Check required config
        if (!client || marketplacePackageId === 'PLACEHOLDER_MARKETPLACE_PACKAGE_ID' || listingRegistryId === 'PLACEHOLDER_REGISTRY_ID') {
            setError("Marketplace contract details not configured or client unavailable.");
            setListings([]);
            return;
        }
        setIsLoading(true);
        setError(null);
        setListings([]);
        console.log("Fetching listings from marketplace...");

        try {
            // --- Step 1: Call the view function to get active listing IDs ---            
            let foundListingObjectIds: string[] = []; // Declare here

            const tx = new Transaction();
            // No gas budget needed for devInspect usually
            tx.moveCall({
               target: `${marketplacePackageId}::marketplace::get_active_listing_ids`,
               arguments: [tx.object(listingRegistryId)],
               typeArguments: [],
            });

            // Sender address might be required for devInspect
            const senderAddress = account?.address; // Get sender address if available
            if (!senderAddress) {
                throw new Error("Wallet not connected for view call.");
            }

            // Execute the dry run
            const response = await client.devInspectTransactionBlock({
                sender: senderAddress,
                transactionBlock: tx, // Pass the constructed Transaction object
            });

            // --- Process the response --- 
            // The path to the returned vector<ID> depends entirely on the SDK's response format for `call` or view functions.
            // For devInspect, it might be under `results` or `returnValues`.
            // This parsing is a GUESS and needs verification.
            // Example: response might be { values: [ [vector_bytes] ] } or similar.
            // Adjust this path based on actual devInspect response structure:
            const potentialResult = (response as any)?.results?.[0]?.returnValues?.[0]; // Example path

            // Process the response
            // The return value might be encoded (e.g., BCS bytes). Decoding might be needed.
            // Assuming for now it returns a structure interpretable as an array of strings.
            if (potentialResult && Array.isArray(potentialResult)) {
                // TODO: Add decoding logic if necessary based on `potentialResult[1]` (type info)
                foundListingObjectIds = potentialResult as string[]; // Assign to outer scope variable
                console.log("View function returned listing IDs:", foundListingObjectIds);
            } else {
                // If the view function call fails or returns unexpected structure
                console.warn("View function get_active_listing_ids did not return an array in the expected location.", response);
                foundListingObjectIds = []; // Default to empty
            }

            if (foundListingObjectIds.length === 0) {
                console.log("No active listing objects found.");
                setIsLoading(false);
                return;
            }

            console.log("Found potential Listing Object IDs:", foundListingObjectIds);

            // Fetch details for each listing object
            const listingDetailsPromises = foundListingObjectIds.map(async (listingId: string) => {
                try {
                    const listingResp = await client.getObject({ id: listingId });
                    const listingContent = listingResp?.data as ListingObjectContent | null;

                    if (!listingContent || listingContent.dataType !== 'moveObject' || !listingContent.type?.startsWith(`${marketplacePackageId}::marketplace::Listing`)) {
                        console.warn(`Object ${listingId} is not a valid Listing object.`);
                        return null;
                    }

                    const fields = listingContent.fields;
                    const nftId = fields.nft_id;

                    // Fetch NFT details separately
                    let nftMetadata: MarketplaceListingData['nftMetadata'] = {};
                    try {
                        const nftResp = await client.getObject({ id: nftId });
                        const nftContent = nftResp?.data as NftObjectContent | null;
                        if (nftContent?.fields) {
                            // TODO: Fetch NFT display object if needed for name/desc/image template
                            // Use fetched collectionDisplayData
                            const displayFields = collectionDisplayData?.fields || {};
                            let imageUrl = displayFields.image_url || '';
                            if (imageUrl && imageUrl.includes('{id}')) {
                                imageUrl = imageUrl.replace('{id}', nftId);
                            }

                            nftMetadata = {
                                name: displayFields.name,
                                description: displayFields.description,
                                imageUrl: imageUrl,
                                amount_kg_co2e: nftContent.fields.amount_kg_co2e ? parseInt(nftContent.fields.amount_kg_co2e, 10) : undefined,
                                activity_type: nftContent.fields.activity_type,
                                issuedTimestamp: nftContent.fields.issuance_timestamp_ms ? parseInt(nftContent.fields.issuance_timestamp_ms, 10) : undefined,
                            };
                        }
                    } catch (nftError) {
                        console.error(`Failed to fetch NFT details for ${nftId}:`, nftError);
                    }

                    return {
                        listingId: listingId,
                        nftId: nftId,
                        priceMicroIota: BigInt(fields.price_micro_iota || '0'),
                        sellerAddress: fields.seller,
                        nftMetadata: nftMetadata,
                    } as MarketplaceListingData;

                } catch (error) {
                    console.error(`Failed to fetch details for listing ${listingId}:`, error);
                    return { listingId, nftId: '', priceMicroIota: BigInt(0), sellerAddress: '', fetchError: `Failed to load listing ${listingId}` } as MarketplaceListingData;
                }
            });

            const results = await Promise.all(listingDetailsPromises);
            // Filter out nulls, TypeScript should infer the type correctly after filter
            const validListings = results.filter((r): r is MarketplaceListingData => r !== null);

            console.log("Processed Listings:", validListings);
            setListings(validListings);

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error("Error fetching marketplace listings:", err);
            setError(`Failed to load marketplace: ${errorMessage}`);
            setListings([]);
        } finally {
            setIsLoading(false);
        }

    }, [client, account, marketplacePackageId, listingRegistryId]);

    // Initial fetch
    useEffect(() => {
        fetchListings();
    }, [fetchListings]);

    // --- Buy Confirmation Polling --- (Similar to retirement polling)
     useEffect(() => {
         if (!buyTxDigest || !isWaitingForBuyConfirm || !client) return;
         console.log(`Polling for buy tx: ${buyTxDigest}`);
         const startTime = Date.now();
         const timeoutDuration = 60000; // 60 seconds timeout

         const intervalId = setInterval(async () => {
             if (Date.now() - startTime > timeoutDuration) {
                 toast.warning("Purchase confirmation timed out. Please check explorer.");
                 clearInterval(intervalId);
                 setIsWaitingForBuyConfirm(false);
                 setBuyTxDigest(undefined);
                 setBuyingListingId(null);
                 return;
             }

             try {
                 const txDetails = await client.getTransactionBlock({ digest: buyTxDigest });
                 const status = (txDetails as any)?.effects?.status?.status;

                 if (status === 'success') {
                     toast.success(`Item purchased successfully! Tx: ${buyTxDigest.substring(0, 6)}...`);
                     clearInterval(intervalId);
                     setIsWaitingForBuyConfirm(false);
                     setBuyTxDigest(undefined);
                     setBuyingListingId(null);
                     fetchListings(); // Refresh listings
                 } else if (status === 'failure') {
                     const errorMsg = (txDetails as any)?.effects?.status?.error || 'Unknown reason';
                     toast.error(`Purchase transaction failed: ${errorMsg}`);
                     clearInterval(intervalId);
                     setIsWaitingForBuyConfirm(false);
                     setBuyTxDigest(undefined);
                     setBuyingListingId(null);
                 }
             } catch (error: unknown) {
                 console.warn("Polling error for buy tx:", error);
             }
         }, 3000);

         return () => clearInterval(intervalId);
     }, [buyTxDigest, isWaitingForBuyConfirm, client, fetchListings]);

    // --- Cancel Confirmation Polling --- //
    useEffect(() => {
        if (!cancelTxDigest || !isWaitingForCancelConfirm || !client) return;
        console.log(`Polling for cancel tx: ${cancelTxDigest}`);
        const startTime = Date.now();
        const timeoutDuration = 60000; // 60 seconds timeout

        const intervalId = setInterval(async () => {
            if (Date.now() - startTime > timeoutDuration) {
                toast.warning("Cancellation confirmation timed out. Please check explorer.");
                clearInterval(intervalId);
                setIsWaitingForCancelConfirm(false);
                setCancelTxDigest(undefined);
                setCancellingListingId(null);
                return;
            }

            try {
                const txDetails = await client.getTransactionBlock({ digest: cancelTxDigest });
                const status = (txDetails as any)?.effects?.status?.status;

                if (status === 'success') {
                    toast.success(`Listing cancelled successfully! Tx: ${cancelTxDigest.substring(0, 6)}...`);
                    clearInterval(intervalId);
                    setIsWaitingForCancelConfirm(false);
                    setCancelTxDigest(undefined);
                    setCancellingListingId(null);
                    fetchListings(); // Refresh listings
                } else if (status === 'failure') {
                    const errorMsg = (txDetails as any)?.effects?.status?.error || 'Unknown reason';
                    toast.error(`Cancellation transaction failed: ${errorMsg}`);
                    clearInterval(intervalId);
                    setIsWaitingForCancelConfirm(false);
                    setCancelTxDigest(undefined);
                    setCancellingListingId(null);
                }
            } catch (error: unknown) {
                console.warn("Polling error for cancel tx:", error);
            }
        }, 3000);

        return () => clearInterval(intervalId);
    }, [cancelTxDigest, isWaitingForCancelConfirm, client, fetchListings]);

    // --- Actions --- //

    const handleBuy = useCallback(async (listing: MarketplaceListingData) => {
        if (!client || !account || !account.address || !marketplacePackageId || marketplacePackageId === 'PLACEHOLDER_MARKETPLACE_PACKAGE_ID') {
            toast.error("Client, account, or Marketplace Package ID not configured.");
            return;
        }
        if (buyingListingId || isTxPending) return; // Prevent multiple buys
        if (account.address === listing.sellerAddress) {
             toast.warning("You cannot buy your own listing.");
             return;
         }

        setBuyingListingId(listing.listingId);
        setBuyTxDigest(undefined);
        setIsWaitingForBuyConfirm(false);
        toast.info(`Preparing to buy item ${listing.nftId.substring(0, 6)}...`);

        try {
            const tx = new Transaction();
            tx.setGasBudget(100_000_000); // Adjust gas budget

            // 1. Need to get a Coin<IOTA> object with the exact price
            // This usually involves splitting coins. The SDK might have helpers, or it needs specific PTB setup.
            // Placeholder: Assuming a helper function `getExactCoin` exists or is handled by SDK implicitly.
            // For now, we construct the call assuming the Coin object is available as an argument.

            // TODO: Implement or verify Coin splitting logic!
            // This is a critical step. For now, we'll use a placeholder object ID.
            const paymentCoinObjectId = "PLACEHOLDER_COIN_OBJECT_ID_WITH_PRICE";

            tx.moveCall({
                target: `${marketplacePackageId}::marketplace::buy_item`,
                arguments: [
                    tx.object(listing.listingId), // The Listing object being bought
                    tx.object(paymentCoinObjectId) // The Coin<IOTA> object with the exact price
                ],
                // typeArguments: [], // Likely none for buy_item
            });

            console.log("Constructed buy tx (WARNING: Payment coin logic is a placeholder):");

            signAndExecuteTransaction(
                { transaction: tx },
                {
                    onSuccess: (result: { digest: TransactionId }) => {
                        console.log("Buy tx submitted:", result);
                        toast.success(`Buy transaction submitted: ${result.digest}. Waiting for confirmation...`);
                        setBuyTxDigest(result.digest);
                        setIsWaitingForBuyConfirm(true);
                    },
                    onError: (error: any) => {
                        console.error("Buy transaction failed:", error);
                        toast.error(`Buy failed: ${error.message || 'Unknown error'}`);
                        setBuyingListingId(null);
                    },
                }
            );

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Error constructing/signing buy transaction:", error);
            toast.error(`Error: ${errorMessage}`);
            setBuyingListingId(null);
        }

    }, [client, account, marketplacePackageId, buyingListingId, isTxPending, signAndExecuteTransaction]);

    const handleCancelListing = useCallback(async (listing: MarketplaceListingData) => {
        if (!client || !account || !account.address || !marketplacePackageId || marketplacePackageId === 'PLACEHOLDER_MARKETPLACE_PACKAGE_ID' || !listingRegistryId || listingRegistryId === 'PLACEHOLDER_REGISTRY_ID') {
            toast.error("Client, account, or contract details not configured.");
            return;
        }
        if (cancellingListingId || isTxPending) return; // Prevent multiple cancels
        if (account.address !== listing.sellerAddress) {
            toast.warning("You cannot cancel a listing that is not yours.");
            return;
        }

        setCancellingListingId(listing.listingId);
        setCancelTxDigest(undefined);
        setIsWaitingForCancelConfirm(false);
        toast.info(`Preparing to cancel listing ${listing.nftId.substring(0, 6)}...`);

        try {
            const tx = new Transaction();
            tx.setGasBudget(50_000_000); // Adjust gas budget if needed

            tx.moveCall({
                target: `${marketplacePackageId}::marketplace::cancel_listing`,
                arguments: [
                    tx.object(listingRegistryId), // Argument 0: The ListingRegistry object
                    tx.object(listing.listingId)  // Argument 1: The Listing object to cancel
                ],
                // typeArguments: [], // None for cancel_listing
            });

            console.log("Constructed cancel listing tx:");

            signAndExecuteTransaction(
                { transaction: tx },
                {
                    onSuccess: (result: { digest: TransactionId }) => {
                        console.log("Cancel tx submitted:", result);
                        toast.success(`Cancel transaction submitted: ${result.digest}. Waiting for confirmation...`);
                        setCancelTxDigest(result.digest);
                        setIsWaitingForCancelConfirm(true);
                    },
                    onError: (error: any) => {
                        console.error("Cancel transaction failed:", error);
                        toast.error(`Cancel failed: ${error.message || 'Unknown error'}`);
                        setCancellingListingId(null);
                    },
                }
            );

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Error constructing/signing cancel transaction:", error);
            toast.error(`Error: ${errorMessage}`);
            setCancellingListingId(null);
        }

    }, [client, account, marketplacePackageId, listingRegistryId, cancellingListingId, isTxPending, signAndExecuteTransaction]);

    // --- Render Functions --- //

    const renderListingCard = (listing: MarketplaceListingData) => {
        const isBuyingThis = buyingListingId === listing.listingId;
        const isCancellingThis = cancellingListingId === listing.listingId;
        const isMyListing = account?.address === listing.sellerAddress;

        // Determine button state based on action type (buy vs cancel)
        const isProcessing = !!buyingListingId || !!cancellingListingId || isTxPending || isWaitingForBuyConfirm || isWaitingForCancelConfirm;
        const buyButtonDisabled = isProcessing || isMyListing;
        const cancelButtonDisabled = isProcessing || !isMyListing;

        // Format price from microIOTA to IOTA string
        const priceInIota = (Number(listing.priceMicroIota) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });

  return (
            <Card key={listing.listingId} className="flex flex-col">
                <CardHeader>
                    <CardTitle className="truncate" title={listing.nftMetadata?.name || 'NFT'}>
                        {listing.nftMetadata?.name || `NFT ${listing.nftId.substring(0, 6)}...`}
                    </CardTitle>
                    <CardDescription className="text-xs truncate" title={listing.nftId}>
                        NFT ID: {listing.nftId}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex-grow">
                    {listing.nftMetadata?.imageUrl ? (
                        <Image
                            src={listing.nftMetadata.imageUrl}
                            alt={listing.nftMetadata.name || 'NFT Image'}
                            width={400}
                            height={240}
                            className="w-full h-48 object-cover rounded"
                            priority={false}
                            onError={(e) => { (e.target as HTMLImageElement).src = '/placeholder-image.png'; }}
                        />
                    ) : (
                        <div className="w-full h-48 bg-secondary rounded flex items-center justify-center text-muted-foreground">No Image</div>
                    )}
                    <div className="mt-4 space-y-1 text-sm">
                         {listing.nftMetadata?.amount_kg_co2e !== undefined && <p><strong>Amount:</strong> {(listing.nftMetadata.amount_kg_co2e / 1000).toLocaleString()} kg CO₂e</p>}
                         {listing.nftMetadata?.activity_type !== undefined && <p><strong>Activity Code:</strong> {listing.nftMetadata.activity_type}</p>}
                         <p><strong>Price:</strong> {priceInIota} IOTA</p>
                         <p className="text-xs text-muted-foreground truncate" title={listing.sellerAddress}><strong>Seller:</strong> {listing.sellerAddress}</p>
                         {listing.fetchError && <p className="text-red-500 text-xs">Error: {listing.fetchError}</p>}
    </div>
                </CardContent>
                <CardFooter className="flex justify-end">
                    {isMyListing ? (
                        <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleCancelListing(listing)}
                            disabled={cancelButtonDisabled}
                        >
                           {isCancellingThis ? (isWaitingForCancelConfirm ? 'Confirming...' : 'Cancelling...') : 'Cancel Listing'}
                        </Button>
                    ) : (
                        <Button
                            size="sm"
                            onClick={() => handleBuy(listing)}
                            disabled={buyButtonDisabled}
                        >
                           {isBuyingThis ? (isWaitingForBuyConfirm ? 'Confirming...' : 'Processing...') : 'Buy Now'}
                        </Button>
                    )}
                </CardFooter>
            </Card>
        );
    };

     const renderSkeletonCard = (key: number) => (
         <Card key={key}>
             <CardHeader>
                 <Skeleton className="h-6 w-3/4" />
                 <Skeleton className="h-4 w-full mt-1" />
             </CardHeader>
             <CardContent>
                 <Skeleton className="w-full h-48 rounded" />
                 <div className="mt-4 space-y-2">
                     <Skeleton className="h-4 w-1/2" />
                     <Skeleton className="h-4 w-1/3" />
                     <Skeleton className="h-4 w-1/4" />
                     <Skeleton className="h-3 w-full" />
                 </div>
             </CardContent>
             <CardFooter>
                 <Skeleton className="h-9 w-full" />
             </CardFooter>
         </Card>
     );


    // --- Main Render --- //
    return (
        <div className="container mx-auto p-4">
            <h1 className="text-3xl font-bold mb-6">Marketplace</h1>

            {/* Error Display */}
            {error && (
                <div className="mb-4 p-4 bg-red-100 border border-red-400 text-red-700 rounded">
                    <p><strong>Error:</strong> {error}</p>
                </div>
            )}

             {/* Reload Button */}
             <div className="mb-4">
                 <Button onClick={fetchListings} disabled={isLoading}>
                     {isLoading ? 'Loading...' : 'Refresh Listings'}
                 </Button>
             </div>

            {/* Listings Grid */}
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                 {isLoading
                     ? [...Array(8)].map((_, i) => renderSkeletonCard(i))
                     : listings.length > 0
                         ? listings.map(renderListingCard)
                         : !error && <p className="col-span-full text-center text-gray-500 mt-8">No items currently listed on the marketplace.</p>
                 }
             </div>
        </div>
    );
} 