'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import NFTCard from '@/components/nft/NFTCard'; // Assuming NFTCard props are adaptable
import {
    useIotaClient,
    useSignAndExecuteTransaction,
    useCurrentAccount
} from '@iota/dapp-kit';
import { Transaction } from '@iota/iota-sdk/transactions';
import { toast } from "sonner";
import { useNetworkVariable } from '@/lib/networkConfig'; // Assuming this exists
// Use string for transaction digests
// import type { TransactionId } from '@iota/iota-sdk/client';
// import type { IObjectInfo } from '@iota/sdk'; // Unused
import { Button } from "@/components/ui/button"; // Add missing import

// --- Data Structures ---

// Interface for the raw data expected from a Listing object
// Adjust based on your actual Move struct for Listing
interface ListingObjectData {
    content?: {
        fields?: {
            id?: string | bigint; // Unique ID within the marketplace contract (if different from object ID)
            seller?: string; // Seller address
            nft_id?: string; // Object ID of the listed NFT
            price?: string | bigint; // Price in base units
            // Add other relevant fields from your Listing struct
        }
    }
}

// Interface for the raw data expected from an NFT object (e.g., CarbonCreditNFT)
interface NftObjectData {
    // Define the expected structure more explicitly
    content?: { // content itself is optional
        dataType?: 'moveObject';
        type?: string;
        hasPublicTransfer?: boolean;
        fields?: { // fields is optional within content
            amount_kg_co2e?: string | number;
            activity_type?: string;
            verification_id?: string;
            issuance_timestamp_ms?: string | number;
            // other NFT-specific fields
        }
    },
    display?: { // Use the display standard for metadata
        data?: {
             name?: string;
             description?: string;
             image_url?: string; // Or url template
             // other display fields
        }
    }
}


// Combined data structure for display
interface CombinedListing {
    listingId: string; // The Object ID of the Listing object itself
    internalId?: string | bigint; // Optional: internal counter ID from listing object data
    tokenId: string; // Object ID of the NFT
    price: bigint; // Price in base units (wei/micro)
    formattedPrice: string; // User-friendly price string
    seller: string; // Seller IOTA address
    nftContract?: string; // NFT's original package/contract ID (if needed)
    metadata?: {
        name?: string;
        description?: string;
        imageUrl?: string;
        // Add other derived/needed metadata fields
    };
    // Use a less strict type to bypass complex inference issues for now
    nftData?: Record<string, any> | null; // Raw NFT fields if needed
    fetchError?: string; // Error fetching this specific listing/NFT
}

// Helper to format base units to display string (assuming 6 decimals)
const formatBaseUnits = (amount: bigint, decimals: number = 6): string => {
    const amountString = amount.toString();
    const len = amountString.length;
    if (len <= decimals) {
        return `0.${amountString.padStart(decimals, '0')}`;
    } else {
        const integerPart = amountString.substring(0, len - decimals);
        const fractionalPart = amountString.substring(len - decimals);
        // Trim trailing zeros from fractional part, but keep at least one if it's not all zeros
        const trimmedFractional = fractionalPart.replace(/0+$/, '');
        return trimmedFractional ? `${integerPart}.${trimmedFractional}` : integerPart;
    }
};


// --- Component ---

const MarketplaceList = () => {
    const account = useCurrentAccount(); // Get connected user account info
    const client = useIotaClient();
    const { mutate: signAndExecuteTransaction, isPending: isTxPending } = useSignAndExecuteTransaction();

    // Get config (replace with actual hook/config)
    const marketplacePackageId = process.env.NEXT_PUBLIC_MARKETPLACE_PACKAGE_ID;
    // const indexerUrl = useNetworkVariable('indexerUrl'); // If using an indexer

    const [listings, setListings] = useState<CombinedListing[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [buyingListingId, setBuyingListingId] = useState<string | null>(null);
    const [buyTxDigest, setBuyTxDigest] = useState<string | undefined>(); // Use string
    const [isWaitingForBuyConfirmation, setIsWaitingForBuyConfirmation] = useState(false);


    // 1. Function to fetch active listing Object IDs
    // This is the most crucial part and depends heavily on your contract design.
    // Option A: View function on marketplace contract that returns Vec<ObjectID>
    // Option B: Query an indexer for objects of type `MarketplacePackageId::marketplace::Listing`
    // Option C: Less ideal: Fetch marketplace object and iterate dynamic fields (if applicable)
    const fetchListingIds = useCallback(async (): Promise<string[]> => {
        if (!client || !marketplacePackageId) return [];
        console.log("Fetching listing IDs...");

        // --- Replace with your actual fetching logic ---
        // Example: Using a hypothetical view function `get_active_listings`
        try {
            // const result = await client.callViewFunction({
            //     packageId: marketplacePackageId,
            //     module: 'marketplace',
            //     function: 'get_active_listings',
            //     args: [],
            //     // typeArguments: []
            // });
            // Assuming result.value is an array of strings (Object IDs)
            // if (Array.isArray(result?.value)) {
            //    console.log("Fetched Listing IDs:", result.value);
            //    return result.value as string[];
            // } else {
            //    console.error("Unexpected result from get_active_listings:", result);
            //    setError("Failed to parse listing IDs from contract.");
            //    return [];
            // }

            // Placeholder: Return empty array until implemented
            console.warn("fetchListingIds: Placeholder implementation. Needs actual logic.");
            toast.info("Marketplace fetching not fully implemented yet.");
            return [];

        } catch (err: any) {
            console.error("Error fetching listing IDs:", err);
            setError(`Failed to fetch listings: ${err.message}`);
            return [];
        }
        // --- End of replacement section ---

    }, [client, marketplacePackageId]);


    // 2. Function to fetch details for multiple objects (Listings and NFTs)
    const fetchObjectsBatch = useCallback(async (objectIds: string[]): Promise<Map<string, any | null>> => {
        const results = new Map<string, any | null>();
        if (!client || objectIds.length === 0) return results;

        console.log("Fetching object details for:", objectIds);
        // Use multi-get if available, otherwise batch requests
        // Note: client.getObjects may not exist, adjust based on SDK
        try {
             // Placeholder: Fetch one by one if batch method isn't available/working
             for (const id of objectIds) {
                 try {
                    const data = await client.getObject({ id: id, options: { showContent: true, showDisplay: true } });
                    results.set(id, data || null);
                 } catch (individualError) {
                    console.warn(`Failed to fetch object ${id}:`, individualError);
                    results.set(id, null); // Mark as failed
                 }
             }

            // Example with a hypothetical batch method (adjust if needed)
            // const responses = await client.getObjects({
            //    objectIds: objectIds,
            //    options: { showContent: true, showDisplay: true }
            // });
            // responses.forEach(resp => {
            //    if (resp.error) {
            //       console.warn(`Failed to fetch object ${resp.objectId}:`, resp.error);
            //       results.set(resp.objectId, null);
            //    } else {
            //       results.set(resp.objectId, resp.data || null);
            //    }
            // });

        } catch (batchError: any) {
             console.error("Error fetching objects batch:", batchError);
             // Mark all as failed in case of total batch failure
             objectIds.forEach(id => results.set(id, null));
             setError(`Failed to fetch object details: ${batchError.message}`);
        }
        console.log("Fetched objects map:", results);
        return results;
    }, [client]);


    // 3. Main data fetching and processing logic
    const loadMarketplaceData = useCallback(async () => {
        setIsLoading(true);
        setError(null);
        setListings([]);

        const listingObjectIds = await fetchListingIds();
        if (listingObjectIds.length === 0) {
            setIsLoading(false);
            // Keep error state if fetchListingIds set one
            return;
        }

        const listingObjectsMap = await fetchObjectsBatch(listingObjectIds);

        const nftIdsToFetch: string[] = [];
        const preliminaryListings: any[] = []; // Temp storage

        // First pass: Process listing objects and collect NFT IDs
        for (const listingId of listingObjectIds) {
            const listingData = listingObjectsMap.get(listingId) as ListingObjectData | null;
            const fields = listingData?.content?.fields;

            if (!fields || !fields.nft_id || !fields.seller || fields.price === undefined) {
                 console.warn(`Incomplete data for listing object ${listingId}:`, listingData);
                preliminaryListings.push({ listingId, fetchError: "Incomplete listing data" });
                continue;
            }

            try {
                const priceBigInt = BigInt(fields.price);
                preliminaryListings.push({
                    listingId: listingId,
                    internalId: fields.id, // Optional internal ID
                    tokenId: fields.nft_id,
                    price: priceBigInt,
                    formattedPrice: formatBaseUnits(priceBigInt, 6), // Adjust decimals if needed
                    seller: fields.seller,
                });
                 if (fields.nft_id) {
                    nftIdsToFetch.push(fields.nft_id);
                 }
            } catch (e) {
                console.error(`Error processing listing ${listingId}:`, e);
                 preliminaryListings.push({ listingId, fetchError: "Error processing listing data" });
            }
        }

        // Fetch NFT objects
        const uniqueNftIds = [...new Set(nftIdsToFetch)];
        const nftObjectsMap = await fetchObjectsBatch(uniqueNftIds);

        // Second pass: Combine listing data with NFT data
        const finalCombinedListings: CombinedListing[] = preliminaryListings.map(prelim => {
            if (prelim.fetchError) return prelim; // Pass through errors

            const nftData = nftObjectsMap.get(prelim.tokenId) as NftObjectData | null;
            if (!nftData) {
                 console.warn(`NFT data not found or fetch failed for ${prelim.tokenId}`);
                return { ...prelim, fetchError: "Failed to fetch NFT details" };
            }

            const displayData = nftData?.display?.data;
            const nftFields = nftData?.content?.fields;

            // Construct metadata - adjust logic based on your display standard and needs
            const metadata = {
                name: displayData?.name || `Token ${prelim.tokenId.substring(0,6)}...`,
                description: displayData?.description,
                 // Construct image URL if it's a template, otherwise use directly
                 // Example: imageUrl: displayData?.image_url?.replace('{id}', prelim.tokenId),
                imageUrl: displayData?.image_url,
            };

            return {
                ...prelim,
                metadata: metadata,
                nftData: nftFields, // Include raw NFT fields if needed by NFTCard
            };
        });

        console.log("Final combined listings:", finalCombinedListings);
        setListings(finalCombinedListings);
        setIsLoading(false);

    }, [fetchListingIds, fetchObjectsBatch]);

    // Initial load and refetch trigger
    useEffect(() => {
        loadMarketplaceData();
    }, [loadMarketplaceData]); // Rerun if dependencies change


    // --- Buy Item Logic ---

    const handleBuyClick = (listing: CombinedListing) => {
        if (!client) {
            toast.error("IOTA client not available.");
            return;
        }
        if (!account) {
            toast.error("Please connect your wallet to buy.");
            return;
        }
        if (listing.seller.toLowerCase() === account.address.toLowerCase()) { // Compare addresses case-insensitively if needed
            toast.warning("You cannot buy your own listing.");
            return;
        }

        // TODO: Check if user has sufficient funds (native or specific FT)
        // This might involve fetching the user's balance or specific coin objects.
        // This check is complex and depends on the payment method. Skipping for now.

        setBuyingListingId(listing.listingId);
        setBuyTxDigest(undefined);
        setIsWaitingForBuyConfirmation(false);
        toast.info(`Initiating purchase for ${listing.metadata?.name || 'NFT'}...`);

        try {
            const tx = new Transaction();
            tx.setGasBudget(100_000_000); // Adjust gas budget

            // Construct the arguments based on the `buyItem` function signature
            // Example: buyItem(marketplace: &mut Marketplace, listing_id: ObjectID, payment: Coin<PAYMENT_TOKEN>)
            tx.moveCall({
                target: `${marketplacePackageId}::marketplace::buyItem`, // Adjust module/function name
                arguments: [
                    // tx.object(marketplaceObjectId), // If marketplace obj is needed
                    tx.object(listing.listingId),    // The ID of the Listing object being bought
                    // tx.object(paymentCoinObjectId), // *** CRUCIAL: ID of the coin object used for payment ***
                                                     // This requires finding/splitting a coin owned by the user
                                                     // with sufficient balance (listing.price).
                                                     // This part needs significant logic (fetch coins, maybe split).
                ],
                // typeArguments: [...] // Specify token type if needed, e.g., Coin<IOTA> or Coin<MyFT>
            });

            // Placeholder for payment coin handling - THIS IS COMPLEX
             toast.error("Payment handling for 'buyItem' is not implemented yet!");
             console.error("Need to implement logic to find/create a payment coin object with value:", listing.price);
             setBuyingListingId(null); // Reset buying state
             return; // Stop before signing

            // signAndExecuteTransaction(...) // Call this once payment coin is handled

        } catch (error: any) {
            console.error('Error constructing buy transaction:', error);
            toast.error(`Transaction construction failed: ${error.message || 'Unknown error'}`);
            setBuyingListingId(null);
        }
    };

    // Effect to poll for buy transaction confirmation
    useEffect(() => {
        // Similar polling logic as in ListItemDialog, using buyTxDigest and setIsWaitingForBuyConfirmation
        // On success:
        // toast.success(`NFT purchased successfully! Listing ID: ${buyingListingId}`);
        // setBuyingListingId(null);
        // setIsWaitingForBuyConfirmation(false);
        // loadMarketplaceData(); // Refresh list
        // On failure/timeout: update state and show toast

        // --- Add polling logic here (copy/adapt from ListItemDialog) ---

    }, [buyTxDigest, isWaitingForBuyConfirmation, client, loadMarketplaceData, buyingListingId]);


    // --- Render Logic ---

    const isActionLoading = isTxPending || isWaitingForBuyConfirmation;

    if (isLoading) {
        return <div className="text-center p-10">Loading marketplace listings...</div>;
    }

    if (error) {
        return <div className="text-center p-10 text-red-500">Error: {error} <Button onClick={loadMarketplaceData} variant="outline" size="sm">Retry</Button></div>;
    }

    const activeListings = listings.filter(l => !l.fetchError); // Filter out items with fetch errors

    if (!isLoading && activeListings.length === 0) {
        return <div className="text-center p-10 text-muted-foreground">No active items listed for sale.</div>;
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {activeListings.map((listing) => {
                const isBuyingThis = isActionLoading && buyingListingId === listing.listingId;
                const isOwner = account?.address?.toLowerCase() === listing.seller?.toLowerCase(); // Check if owner

                return (
                    <NFTCard
                        key={listing.listingId}
                        // Pass necessary props to NFTCard - adjust based on NFTCard's needs
                        tokenId={listing.tokenId} // Pass NFT Object ID
                        name={listing.metadata?.name}
                        description={listing.metadata?.description}
                        imageUrl={listing.metadata?.imageUrl}
                        price={listing.formattedPrice} // Formatted price string
                        // TODO: Pass price currency/token symbol
                        actionButtonLabel={isBuyingThis ? "Buying..." : isOwner ? "Your Listing" : "Buy Now"}
                        onActionClick={() => handleBuyClick(listing)}
                        // actionButtonDisabled prop removed - handle disabled state inside NFTCard if needed, or pass isOwner/isBuyingThis
                    />
                );
             })}
             {/* Optionally display listings with errors */}
             {listings.filter(l => l.fetchError).map(listing => (
                 <div key={listing.listingId} className="p-4 border border-destructive rounded-md bg-destructive/10 text-destructive">
                    <p className="font-semibold">Error loading listing</p>
                    <p className="text-xs">ID: {listing.listingId.substring(0,10)}...</p>
                    <p className="text-xs">Reason: {listing.fetchError}</p>
                 </div>
             ))}
        </div>
    );
};

export default MarketplaceList;