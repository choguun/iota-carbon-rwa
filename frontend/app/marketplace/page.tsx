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

// --- Component --- //

export default function MarketplacePage() {
    const account = useCurrentAccount();
    const client = useIotaClient();
    const { mutate: signAndExecuteTransaction, isPending: isTxPending } = useSignAndExecuteTransaction();

    const [listings, setListings] = useState<MarketplaceListingData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // State for buy transaction
    const [buyingListingId, setBuyingListingId] = useState<string | null>(null);
    const [buyTxDigest, setBuyTxDigest] = useState<TransactionId | undefined>();
    const [isWaitingForBuyConfirm, setIsWaitingForBuyConfirm] = useState(false);

    // --- Data Fetching Logic --- //

    // TODO: Implement proper fetching of listings
    // This likely requires a view function in the marketplace contract or querying dynamic fields/events.
    // For now, we'll use a placeholder.
    const fetchListings = useCallback(async () => {
        if (!client || marketplacePackageId === 'PLACEHOLDER_MARKETPLACE_PACKAGE_ID') {
            setError("Marketplace contract not configured or client unavailable.");
            setListings([]);
            return;
        }
        setIsLoading(true);
        setError(null);
        setListings([]);
        console.log("Fetching listings from marketplace...");

        try {
            // Placeholder: In a real scenario, you would query the blockchain.
            // Example: Querying dynamic fields of a central marketplace object, or using an indexer.
            // const queryResult = await client.getDynamicFields({ parentId: marketplaceObjectId });
            // For now, simulate finding some listing object IDs (replace with actual logic)
            const foundListingObjectIds: string[] = []; // Replace with actual query result IDs

            if (foundListingObjectIds.length === 0) {
                console.log("No listing objects found (placeholder).");
                setIsLoading(false);
                return;
            }

            console.log("Found potential Listing Object IDs:", foundListingObjectIds);

            // Fetch details for each listing object
            const listingDetailsPromises = foundListingObjectIds.map(async (listingId) => {
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
                            nftMetadata = {
                                // name: fetched from display object,
                                // description: fetched from display object,
                                // imageUrl: constructed from display object template,
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
            const validListings = results.filter(r => r !== null) as MarketplaceListingData[];

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

    }, [client]);

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


    // --- Render Functions --- //

    const renderListingCard = (listing: MarketplaceListingData) => {
        const isBuyingThis = buyingListingId === listing.listingId;
        const buyButtonDisabled = !!buyingListingId || isTxPending || isWaitingForBuyConfirm || account?.address === listing.sellerAddress;

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
                <CardFooter>
                    <Button
                        className="w-full"
                        size="sm"
                        onClick={() => handleBuy(listing)}
                        disabled={buyButtonDisabled}
                    >
                        {isBuyingThis ? (isWaitingForBuyConfirm ? 'Confirming...' : 'Processing...') : 'Buy Now'}
                    </Button>
                     {/* TODO: Add Cancel Listing button if seller === account?.address */}
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