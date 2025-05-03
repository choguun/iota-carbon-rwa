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
import { bcs } from '@iota/iota-sdk/bcs';

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
    id: string;          // ID of the Listing Move object
    version: string;     // Version of the Listing Move object
    digest: string;      // Digest of the Listing Move object
    nftId: string;       // ID of the NFT object
    price_micro_iota?: string; // Price from listing fields (u64 as string), made optional
    seller?: string;      // Seller address from listing fields, made optional
    nftData?: {          // Data fetched for the NFT
        fields?: CarbonCreditNftFields;
        type?: string;
        display?: {      // Display data merged in
            name?: string;
            description?: string;
            image_url?: string;
        };
    };
    fetchError?: string; // Include error specific to this listing fetch
}

// Basic interface for coin objects from getCoins
// TODO: Refine based on actual SDK response
interface IotaCoin {
    coinObjectId: string;
    balance: string; // u64 as string
    // Potentially other fields like coinType, digest, version
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

    // State to hold user's IOTA coin objects
    // TODO: Define a more specific Coin interface based on SDK response
    const [userCoins, setUserCoins] = useState<any[]>([]);

    // --- Data Fetching Logic --- //

    // Fetch NFT Collection Display Data (similar to my-assets)
    const fetchDisplayData = useCallback(async () => {
        if (!client || !nftDisplayObjectId || nftDisplayObjectId === 'PLACEHOLDER_NFT_DISPLAY_ID') {
            console.error("NFT Collection Display Object ID not configured.");
            return;
        }
        console.log("Fetching NFT Collection Display object:", nftDisplayObjectId);
        try {
            // Ensure options are included to fetch content and type
            const response = await client.getObject({ 
                id: nftDisplayObjectId,
                options: { showContent: true, showType: true } 
            });
            // Access data potentially nested under 'content'
            const displayDataRaw = response?.data as any;
            console.log("Raw Display Object Response:", displayDataRaw); // Log the raw response
            // Check for content and then fields within content
            const potentialFields = displayDataRaw?.content?.fields; 

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
        setIsLoading(true);
        setError(null);
        setListings([]); // Clear previous listings

        // Add check for connected account before proceeding
        if (!account?.address) {
            console.log("fetchListings: Wallet not connected, waiting.");
            // Don't set loading to false here, let useEffect re-trigger
            return; 
        }

        const senderAddress = account.address;

        // Check required config
        let foundListingObjectIds: string[] = []; // Declare outside the try block

        if (!client || marketplacePackageId === 'PLACEHOLDER_MARKETPLACE_PACKAGE_ID' || listingRegistryId === 'PLACEHOLDER_REGISTRY_ID') {
            setError("Marketplace contract details not configured or client unavailable.");
            setListings([]);
            return;
        }
        setIsLoading(true);
        setError(null);
        setListings([]);
        console.log("fetchListings: Using Marketplace Pkg:", marketplacePackageId);
        console.log("fetchListings: Using Registry ID:", listingRegistryId);
        console.log("Fetching listings from marketplace...");

        try {
            // Use devInspectTransactionBlock for read-only calls (Verify with SDK docs)
            // No gas budget needed for devInspect usually
            const tx = new Transaction();
            tx.moveCall({
               target: `${marketplacePackageId}::marketplace::get_active_listing_ids`,
               arguments: [tx.object(listingRegistryId)],
               typeArguments: [],
            });

            // Sender address might be required for devInspect
            if (!senderAddress) {
                console.error("fetchListings: Wallet not connected, cannot perform view call.");
                throw new Error("Wallet not connected for view call.");
            }

            console.log("fetchListings: Preparing to call devInspectTransactionBlock...");
            // Execute the dry run
            // Note: Ensure devInspectTransactionBlock is the correct method in your IOTA SDK version.
            const response = await client.devInspectTransactionBlock({
                sender: senderAddress,
                transactionBlock: tx, // Pass the constructed Transaction object
            });

            console.log("Raw devInspect response:", JSON.stringify(response, null, 2));

            // Use a different name to avoid conflict later
            const viewCallResults = (response as any)?.results;
            const commandResult = viewCallResults?.[0]; // Result of the first (and only) command
            const returnValues = commandResult?.returnValues; // Return values of that command

            if (!returnValues || returnValues.length === 0) {
                console.warn("devInspectTransactionBlock did not return any values.", response);
                foundListingObjectIds = [];
            } else {
                // Assuming the first return value contains our vector<ID>
                // The structure is often [value, typeInfo]
                const [value, typeInfo] = returnValues[0];
                console.log("Raw return value:", value, "Type info:", typeInfo);

                console.log("Type of raw return value:", typeof value);
                console.log("Is raw return value an array?", Array.isArray(value));

                // --- Decode the returned value using BCS ---
                try {
                    // Type 'vector<address>' should decode ID bytes to hex strings
                    // Ensure 'value' is Uint8Array; Array.isArray check suggests it might be number[]
                    const bytesToDecode = Array.isArray(value) ? Uint8Array.from(value) : value;
                    // Use the specific BCS type for deserialization
                    foundListingObjectIds = bcs.vector(bcs.Address).parse(bytesToDecode);
                    console.log("Decoded listing IDs via BCS:", foundListingObjectIds);
                } catch (decodeError: any) {
                    console.error("BCS Decoding failed:", decodeError);
                    console.error("Raw value causing decode error:", value);
                    toast.error(`Failed to decode listing IDs: ${decodeError.message}`);
                    foundListingObjectIds = [];
                }
            }

             // Log found IDs *before* fetching details
             console.log("Found listing IDs before detail fetching:", foundListingObjectIds);


             // --- Step 2: Fetch details for found listing IDs ---
             if (foundListingObjectIds.length === 0) {
                 console.log("No listing IDs found to fetch details for.");
                 // No need to setListings here, it's done in the finally block if needed
             } else {
                 console.log("Fetching details for listing IDs:", foundListingObjectIds);

                 const listingDetailsPromises = foundListingObjectIds.map(async (listingId: string) => {
                     try {
                         const listingResp = await client.getObject({
                             id: listingId,
                             options: { showContent: true, showType: true }
                         });
                         console.log(`Checking listing object ${listingId}:`, listingResp?.data);

                         const listingContent = listingResp?.data?.content as any;
                         const expectedTypePrefix = `${marketplacePackageId}::marketplace::Listing`;
                         console.log("Expecting type to start with:", expectedTypePrefix);

                         if (listingContent &&
                             listingContent.dataType === 'moveObject' &&
                             listingContent.type?.startsWith(expectedTypePrefix))
                         {
                             const fields: ListingFields = listingContent.fields;
                             console.log(`Listing ${listingId} Fields:`, fields); // Log the fields object
                             const nftId = fields?.nft_id; // Still useful for identification/keys
                             
                             // Access nested NFT fields directly - ** ADJUST BASED ON LOG **
                             const nestedNftFields = fields?.nft?.fields as CarbonCreditNftFields | undefined;
                             const nestedNftType = fields?.nft?.type as string | undefined;

                             if (!nftId) {
                                 console.warn(`Listing ${listingId} has no nft_id field.`);
                                 // Return error object
                                 return { id: listingId, nftId: 'unknown', fetchError: `Listing ${listingId} is missing nft_id.` } as MarketplaceListingData;
                             }
                             if (!nestedNftFields) {
                                 console.warn(`Listing ${listingId} is missing nested NFT fields.`);
                                  // Return error object
                                 return { id: listingId, nftId: nftId, fetchError: `Listing ${listingId} is missing nested NFT data.` } as MarketplaceListingData;
                             }

                             // Construct the object using nested data
                             return {
                                 id: listingId,
                                 version: listingResp.data?.version ?? 'unknown',
                                 digest: listingResp.data?.digest ?? 'unknown',
                                 nftId: nftId, // Keep original ID for reference
                                 price_micro_iota: fields?.price_micro_iota,
                                 seller: fields?.seller,
                                 nftData: { // Store nested NFT data directly
                                     fields: nestedNftFields,
                                     type: nestedNftType, // Get type from nested data too
                                     display: collectionDisplayData?.fields || {}
                                 },
                                 fetchError: undefined
                             };
                         } else {
                             console.warn(`Object ${listingId} is not a valid Listing object or format is unexpected.`, listingContent);
                             // Return object with fetchError for this specific listing
                             return { id: listingId, nftId: 'unknown', fetchError: `Listing ${listingId} invalid.` } as MarketplaceListingData;
                         }
                     } catch (e) {
                         console.error(`Error fetching details for listing ${listingId}:`, e);
                         // Return object with fetchError for this specific listing
                         const errorMsg = e instanceof Error ? e.message : String(e);
                         return { id: listingId, nftId: 'unknown', fetchError: `Failed to fetch ${listingId}: ${errorMsg}` } as MarketplaceListingData;
                     }
                 });

                 const results = await Promise.all(listingDetailsPromises);
                 // Filter out nulls (though map now returns objects with fetchError instead of null)
                 // We filter for listings where fetchError is NOT defined
                 const validListings = results.filter((r): r is MarketplaceListingData => r !== null && r.fetchError === undefined);


                 console.log("Processed Listings:", validListings);
                 setListings(validListings);
             }


        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            console.error("fetchListings: Error during devInspect or parsing:", err);
            // Set general error for the whole fetch operation
            setError(`Failed to load marketplace listings: ${errorMessage}`);
            setListings([]); // Clear listings on general error
        } finally {
            setIsLoading(false);
        }
    }, [client, account, marketplacePackageId, listingRegistryId, collectionDisplayData]); // Add collectionDisplayData dependency

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
                // Add options to fetch effects and log the details
                const txDetails = await client.getTransactionBlock({ 
                    digest: cancelTxDigest, 
                    options: { showEffects: true }
                });
                console.log('Polling cancel tx details:', txDetails);
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

    // Function to fetch user's IOTA coins
    const fetchUserCoins = useCallback(async () => {
        if (!client || !account?.address) {
            console.log("Cannot fetch coins, client or account not available.");
            setUserCoins([]);
            return [];
        }
        try {
            console.log(`Fetching coins for ${account.address}...`);
            // Assuming getCoins fetches native IOTA coins by default, or specify coinType if needed
            const response = await client.getCoins({ owner: account.address });
            // TODO: Adjust parsing based on actual response structure
            const coins = (response as any)?.data || []; 
            console.log("Fetched user coins:", coins);
            setUserCoins(coins);
            return coins;
        } catch (error) {
            console.error("Failed to fetch user coins:", error);
            toast.error(`Failed to fetch wallet balance: ${error instanceof Error ? error.message : String(error)}`);
            setUserCoins([]);
            return [];
        }
    }, [client, account]);

    // --- Actions --- //

    // TODO: Implement coin splitting logic for handleBuy
    const handleBuy = useCallback(async (listing: MarketplaceListingData) => {
        if (!client || !account || !account.address || !marketplacePackageId || marketplacePackageId === 'PLACEHOLDER_MARKETPLACE_PACKAGE_ID') {
            toast.error("Client, account, or Marketplace Package ID not configured.");
            return;
        }
        if (buyingListingId || isTxPending) return; // Prevent multiple buys
        if (account.address === listing.seller) {
             toast.warning("You cannot buy your own listing.");
             return;
         }

        setBuyingListingId(listing.id);
        setBuyTxDigest(undefined);
        setIsWaitingForBuyConfirm(false);
        toast.info(`Preparing to buy item ${listing.nftId.substring(0, 6)}...`);

        try {
            // Fetch user's coins first
            const currentCoins = await fetchUserCoins(); // Assumes this returns IotaCoin[] or similar
            if (currentCoins.length === 0) {
                toast.error("Could not find any IOTA coins in your wallet.");
                setBuyingListingId(null);
                return;
            }

            // 2. Find a suitable coin
            const requiredAmount = BigInt(listing.price_micro_iota || '0');
            let paymentCoinInput: { type: 'object', objectId: string } | { type: 'split', objectId: string, amount: bigint } | null = null;

            // Sort coins descending by balance to prioritize using larger coins first for splitting
            const sortedCoins = currentCoins
                .map((coin: IotaCoin): IotaCoin & { balanceBigInt: bigint } => ({ // Add type to coin parameter
                    ...coin,
                    balanceBigInt: BigInt(coin.balance || '0')
                }))
                // Add types to sort parameters
                .sort((a: { balanceBigInt: bigint }, b: { balanceBigInt: bigint }) => Number(b.balanceBigInt - a.balanceBigInt));

            for (const coin of sortedCoins) {
                if (coin.balanceBigInt >= requiredAmount) {
                    if (coin.balanceBigInt === requiredAmount) {
                        // Found exact match
                        paymentCoinInput = { type: 'object', objectId: coin.coinObjectId };
                        console.log(`Found exact match coin: ${coin.coinObjectId}`);
                    } else {
                        // Found coin to split
                        paymentCoinInput = { type: 'split', objectId: coin.coinObjectId, amount: requiredAmount };
                        console.log(`Found coin to split: ${coin.coinObjectId}, balance: ${coin.balanceBigInt}, required: ${requiredAmount}`);
                    }
                    break; // Stop after finding the first suitable coin
                }
            }

            if (!paymentCoinInput) {
                // TODO: Implement merging logic if desired
                toast.error(`Insufficient balance. No single coin found with at least ${Number(requiredAmount) / 1_000_000} IOTA.`);
                setBuyingListingId(null);
                return;
            }

            // 3. Construct the transaction
            const tx = new Transaction();
            tx.setGasBudget(150_000_000); // May need higher budget for split

            let paymentCoinArg; // This will hold the argument for the moveCall

            if (paymentCoinInput.type === 'split') {
                // Command 0: Split Coin
                // Assumes splitCoins takes the coin *object* and an array of amounts to split off
                // Verify method name and argument structure with SDK docs!
                const splitResult = tx.splitCoins(tx.object(paymentCoinInput.objectId), [tx.pure.u64(paymentCoinInput.amount)]);
                // The payment coin is the result of this split command
                paymentCoinArg = splitResult; 
                console.log(`Prepared splitCoins command for ${paymentCoinInput.objectId}`);
            } else {
                // Use the exact match coin directly
                paymentCoinArg = tx.object(paymentCoinInput.objectId);
                console.log(`Using direct coin object: ${paymentCoinInput.objectId}`);
            }

            tx.moveCall({
                target: `${marketplacePackageId}::marketplace::buy_item`,
                arguments: [
                    tx.object(listing.id), // The Listing object being bought
                    paymentCoinArg                // The result of splitCoins or the direct coin object
                ],
                // typeArguments: [], // Likely none for buy_item
            });

            console.log("Constructed buy transaction with coin logic.");

            // 4. Sign and Execute
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
                        setBuyingListingId(null); // Reset on error
                    },
                }
            );

        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Error constructing/signing buy transaction:", error);
            toast.error(`Error during buy process: ${errorMessage}`);
            setBuyingListingId(null); // Reset on error
        }

    }, [client, account, marketplacePackageId, buyingListingId, isTxPending, signAndExecuteTransaction, fetchUserCoins]);

    const handleCancelListing = useCallback(async (listing: MarketplaceListingData) => {
        if (!client || !account || !account.address || !marketplacePackageId || marketplacePackageId === 'PLACEHOLDER_MARKETPLACE_PACKAGE_ID' || !listingRegistryId || listingRegistryId === 'PLACEHOLDER_REGISTRY_ID') {
            toast.error("Client, account, or contract details not configured.");
            return;
        }
        if (cancellingListingId || isTxPending) return; // Prevent multiple cancels
        if (account.address !== listing.seller) {
            toast.warning("You cannot cancel a listing that is not yours.");
            return;
        }

        setCancellingListingId(listing.id);
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
                    tx.object(listing.id)  // Argument 1: The Listing object to cancel
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
        const isBuyingThis = buyingListingId === listing.id;
        const isCancellingThis = cancellingListingId === listing.id;
        const isMyListing = account?.address === listing.seller;

        // Determine button state based on action type (buy vs cancel)
        const isProcessing = !!buyingListingId || !!cancellingListingId || isTxPending || isWaitingForBuyConfirm || isWaitingForCancelConfirm;
        // Explicitly check if fetchError is truthy (exists)
        const buyButtonDisabled = isProcessing || isMyListing || !!listing.fetchError; 
        const cancelButtonDisabled = isProcessing || !isMyListing || !!listing.fetchError;

        // Format price from microIOTA to IOTA string
        // Use price_micro_iota and handle potential undefined value
        const priceMicroIota = BigInt(listing.price_micro_iota || '0');
        const priceInIota = (Number(priceMicroIota) / 1_000_000).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 });

  return (
            <Card key={listing.id} className="flex flex-col">
                <CardHeader>
                    <CardTitle className="truncate" title={listing.nftData?.display?.name || 'NFT'}>
                        {listing.nftData?.display?.name || `NFT ${listing.nftId.substring(0, 6)}...`}
                    </CardTitle>
                    <CardDescription className="text-xs truncate" title={listing.nftId}>
                        NFT ID: {listing.nftId}
                    </CardDescription>
                </CardHeader>
                <CardContent className="flex-grow">
                    {listing.nftData?.display?.image_url ? (
                        <Image
                            src={listing.nftData.display.image_url}
                            alt={listing.nftData.display.name || 'NFT Image'}
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
                         {/* Display fetch error if present */}
                         {listing.fetchError && <p className="text-red-500 text-xs font-semibold mb-2">Error loading listing: {listing.fetchError}</p>}
                         {/* Use optional chaining and check fields */}
                         {listing.nftData?.fields?.amount_kg_co2e !== undefined && <p><strong>Amount:</strong> {(Number(listing.nftData.fields.amount_kg_co2e) / 1000).toLocaleString()} kg CO₂e</p>}
                         {listing.nftData?.fields?.activity_type !== undefined && <p><strong>Activity Code:</strong> {listing.nftData.fields.activity_type}</p>}
                         <p><strong>Price:</strong> {priceInIota} IOTA</p>
                         <p className="text-xs text-muted-foreground truncate" title={listing.seller || 'Unknown Seller'}><strong>Seller:</strong> {listing.seller || 'Unknown Seller'}</p>
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
                         // Update empty state message
                         : !error && <p className="col-span-full text-center text-gray-500 mt-8">No items currently listed, or failed to load listings.</p>
                 }
             </div>
        </div>
    );
} 