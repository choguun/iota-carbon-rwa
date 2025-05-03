'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    useIotaClient,
    useSignAndExecuteTransaction,
    useCurrentAccount, // Or useCurrentAccount
} from '@iota/dapp-kit';
import { Transaction } from '@iota/iota-sdk/transactions';
import type { TransactionDigest, IObjectInfo, IOutputResponse } from '@iota/sdk'; // Import relevant types
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useNetworkVariable } from '@/lib/networkConfig'; // Assuming this exists
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip" // Assuming this is still valid


// --- IOTA Data Structures ---

// Interface for the raw data expected from a Listing object on IOTA
interface ListingObjectData {
    content?: {
        fields?: {
            id?: string | bigint; // Optional internal ID
            seller?: string; // Seller IOTA address (bech32)
            nft_id?: string; // Object ID of the listed NFT
            price?: string | bigint; // Price in base units (e.g., microIOTA)
        }
    }
    // Include other fields if needed
}

// Interface for the raw data expected from an NFT object on IOTA
interface NftObjectData {
     objectId: string; // Add objectId here for easier access
     content?: {
        type?: string; // e.g., "0xPACKAGE::module::NftType"
        fields?: {
            // NFT-specific fields like amount_kg_co2e, etc.
            [key: string]: any; // Allow flexible fields
        }
    },
    display?: {
        data?: {
             name?: string;
             description?: string;
             image_url?: string; // Standard display field for image
             // other display fields
        }
    }
}

// Combined data structure for display
interface CombinedListing {
    listingId: string; // The Object ID of the Listing object itself
    internalId?: string | bigint; // Optional: internal counter ID
    tokenId: string; // Object ID of the NFT
    price: bigint; // Price in base units
    formattedPrice: string; // User-friendly price string (e.g., "10.5 IOTA")
    seller: string; // Seller IOTA address
    metadata?: {
        name?: string;
        description?: string;
        imageUrl?: string;
    };
    nftData?: NftObjectData; // Store the full NFT object data if needed later
    fetchError?: string; // Error fetching this specific listing/NFT
}

// --- Helper Functions ---

// Helper to format base units (microIOTA) to display string (IOTA)
const formatBaseUnits = (amount: bigint, decimals: number = 6): string => {
    if (typeof amount !== 'bigint') {
        console.warn("formatBaseUnits received non-bigint:", amount);
        return "0"; // Or handle error appropriately
    }
    const amountString = amount.toString();
    const len = amountString.length;
    let integerPart = '0';
    let fractionalPart = '';

    if (len <= decimals) {
        fractionalPart = amountString.padStart(decimals, '0');
    } else {
        integerPart = amountString.substring(0, len - decimals);
        fractionalPart = amountString.substring(len - decimals);
    }
    // Trim trailing zeros from fractional part, but keep '.0' if needed
    const trimmedFractional = fractionalPart.replace(/0+$/, '');
    return trimmedFractional ? `${integerPart}.${trimmedFractional}` : integerPart;
};

// Helper to find a suitable coin for payment (Placeholder - needs real implementation)
// This is complex and requires fetching user's UTXOs/outputs
async function findPaymentCoin(
    client: any, // Use specific client type from dapp-kit/sdk
    ownerAddress: string,
    requiredAmount: bigint
): Promise<string | null> {
    console.log(`Searching for coin >= ${requiredAmount} microIOTA for ${ownerAddress}`);
    toast.info("Searching wallet for suitable funds...", { duration: 2000 });

    // --- Placeholder Logic ---
    // In a real scenario:
    // 1. Use client.getBasicOutputIds or similar to find UTXOs owned by the address.
    // 2. Fetch details for each output using client.getOutput.
    // 3. Filter for basic outputs with sufficient amount and no unlock conditions preventing spending.
    // 4. If an exact match is found, return its outputId.
    // 5. If a larger coin is found, you might need a transaction block that *splits* it first.
    // 6. If no single coin is sufficient, you might need to combine multiple coins (complex tx block).

    console.error("findPaymentCoin: Placeholder implementation! Needs logic to query account UTXOs.");
    toast.error("Wallet query for payment not implemented yet.", { duration: 5000 });
    return null; // Return null to indicate failure in placeholder
}


// --- Component ---

const ITEMS_PER_PAGE = 8; // Number of items to show initially and per load

export default function MarketplacePage() {
    const account = useCurrentAccount(); // Get connected user account info
    const client = useIotaClient();
    const { mutate: signAndExecuteTransaction, isPending: isTxPending } = useSignAndExecuteTransaction();

    // Get config (replace with actual hook/config)
    const marketplacePackageId = useNetworkVariable('marketplacePackageId');
    // const marketplaceObjectId = useNetworkVariable('marketplaceObjectId'); // If needed for calls

    const [listings, setListings] = useState<CombinedListing[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [displayCount, setDisplayCount] = useState(ITEMS_PER_PAGE);

    // State for buy/cancel actions
    const [actionListingId, setActionListingId] = useState<string | null>(null); // For both buy/cancel
    const [actionTxDigest, setActionTxDigest] = useState<TransactionDigest | undefined>();
    const [isWaitingForConfirmation, setIsWaitingForConfirmation] = useState(false);
    const [currentAction, setCurrentAction] = useState<'buy' | 'cancel' | null>(null);

    // 1. Function to fetch active listing Object IDs (Adapt from MarketplaceList)
    const fetchListingIds = useCallback(async (): Promise<string[]> => {
        if (!client || !marketplacePackageId) return [];
        console.log("Fetching listing IDs...");
        setIsLoading(true); // Start loading indicator early
        setError(null);

        try {
            // --- Replace with your actual fetching logic ---
            // Example: Using a hypothetical view function `get_active_listings`
            // const result = await client.callViewFunction({
            //     packageId: marketplacePackageId,
            //     module: 'marketplace', // Adjust module name
            //     function: 'get_active_listings',
            //     args: [],
            // });
            // if (result?.items && Array.isArray(result.items)) {
            //     // Assuming the view function returns { items: ["0x...", "0x..."] }
            //     const ids = result.items.map((item: any) => item?.objectId || item?.id).filter(Boolean); // Adjust based on actual return structure
            //     console.log("Fetched Listing IDs:", ids);
            //     return ids;
            // } else {
            //    console.error("Unexpected result from get_active_listings:", result);
            //    setError("Failed to parse listing IDs from contract view function.");
            //    return [];
            // }

            // Placeholder:
            console.warn("fetchListingIds: Placeholder implementation.");
             // toast.info("Marketplace fetching not fully implemented yet."); // Remove toast if annoying
            return []; // Return empty in placeholder

        } catch (err: any) {
            console.error("Error fetching listing IDs:", err);
            setError(`Failed to fetch listings: ${err.message || 'Unknown error'}`);
            return [];
        } finally {
           // Don't set isLoading false here, wait for details
        }
    }, [client, marketplacePackageId]);

    // 2. Function to fetch details for multiple objects (Adapt from MarketplaceList)
    const fetchObjectsBatch = useCallback(async (objectIds: string[]): Promise<Map<string, IObjectInfo | null>> => {
         const results = new Map<string, IObjectInfo | null>();
        if (!client || objectIds.length === 0) return results;

        console.log("Fetching object details for:", objectIds);
        try {
            // Attempt to fetch objects one by one as batch methods might not be standard/reliable in all SDK versions
            for (const id of objectIds) {
                try {
                    // Fetch with content and display info
                    const response = await client.getObject({ objectId: id, options: { showContent: true, showDisplay: true } });
                    results.set(id, response || null); // Store response or null if not found/error during fetch
                } catch (individualError) {
                    console.warn(`Failed to fetch object ${id}:`, individualError);
                    results.set(id, null); // Mark as failed
                }
            }
        } catch (batchError: any) { // Catch errors in the loop structure itself
            console.error("Error during sequential object fetching:", batchError);
            objectIds.forEach(id => results.set(id, null)); // Mark all as failed on outer error
            setError(`Failed to fetch object details: ${batchError.message}`);
        }
        console.log("Fetched objects map:", results);
        return results;
    }, [client]);

     // 3. Main data fetching and processing logic (Adapt from MarketplaceList)
    const loadMarketplaceData = useCallback(async () => {
        setIsLoading(true); // Ensure loading is true at start
        setError(null);
        setListings([]); // Clear previous listings

        const listingObjectIds = await fetchListingIds();
        if (!client) { // Check client again in case it disconnected
             setError("IOTA client not available.");
             setIsLoading(false);
             return;
        }
        if (listingObjectIds.length === 0 && !error) { // If no IDs and no error yet
            console.log("No active listing IDs found.");
             setIsLoading(false); // Stop loading if no listings to process
            return;
        }
        // If there was an error fetching IDs, error state is already set, isLoading will be false later

        const listingObjectsMap = await fetchObjectsBatch(listingObjectIds);

        const nftIdsToFetch: string[] = [];
        const preliminaryListings: any[] = [];

        for (const listingId of listingObjectIds) {
            const listingInfo = listingObjectsMap.get(listingId);
            // Cast to expected structure - adjust if needed
            const listingData = listingInfo?.data as ListingObjectData | undefined;
            const fields = listingData?.content?.fields;

            if (!listingInfo || !fields?.nft_id || !fields.seller || fields.price === undefined) {
                console.warn(`Incomplete/failed data for listing object ${listingId}:`, listingInfo);
                preliminaryListings.push({ listingId, fetchError: `Incomplete or missing listing data (ID: ${listingId.substring(0, 6)}...)` });
                continue;
            }

            try {
                const priceBigInt = BigInt(fields.price); // Assuming price is string/number convertible to bigint
                preliminaryListings.push({
                    listingId: listingId,
                    internalId: fields.id,
                    tokenId: fields.nft_id,
                    price: priceBigInt,
                    formattedPrice: `${formatBaseUnits(priceBigInt, 6)} IOTA`, // Assuming 6 decimals for IOTA
                    seller: fields.seller,
                });
                nftIdsToFetch.push(fields.nft_id);
            } catch (e: any) {
                console.error(`Error processing listing ${listingId}:`, e);
                preliminaryListings.push({ listingId, fetchError: `Processing error: ${e.message}` });
            }
        }

        const uniqueNftIds = [...new Set(nftIdsToFetch)];
        const nftObjectsMap = await fetchObjectsBatch(uniqueNftIds);

        const finalCombinedListings: CombinedListing[] = preliminaryListings.map(prelim => {
            if (prelim.fetchError) return prelim;

            const nftInfo = nftObjectsMap.get(prelim.tokenId);
             // Cast to expected structure - adjust if needed
            const nftData = nftInfo?.data as NftObjectData | undefined;

            if (!nftInfo || !nftData) {
                console.warn(`NFT data not found or fetch failed for ${prelim.tokenId}`);
                return { ...prelim, fetchError: `Failed to fetch NFT details (ID: ${prelim.tokenId.substring(0, 6)}...)` };
            }
            
             // Add objectId to nftData for convenience if not already there
             if (!nftData.objectId) {
                 nftData.objectId = prelim.tokenId;
             }

            const displayData = nftData?.display?.data;
            const metadata = {
                name: displayData?.name || `Object ${prelim.tokenId.substring(0, 6)}...`,
                description: displayData?.description,
                imageUrl: displayData?.image_url, // Use display standard field
            };

            return {
                ...prelim,
                metadata: metadata,
                nftData: nftData, // Store the full NFT data
            };
        });

        console.log("Final combined listings:", finalCombinedListings);
        setListings(finalCombinedListings);
        setError(null); // Clear previous errors if successful
        setIsLoading(false); // Finally set loading false

    }, [fetchListingIds, fetchObjectsBatch, client, error]); // Add client and error dependencies

    // Initial load and refetch trigger
  useEffect(() => {
        if (client) { // Only load if client is available
             loadMarketplaceData();
        }
         // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [client]); // Reload if client instance changes (e.g., network switch)


  // --- Buy Item Logic ---
    const handleBuy = useCallback(async (listing: CombinedListing) => {
        if (!client || !account || !marketplacePackageId) {
            toast.error("Client or account not available.");
            return;
        }
        if (isTxPending || isWaitingForConfirmation) return; // Prevent concurrent actions

         setActionListingId(listing.listingId);
         setCurrentAction('buy');
         setActionTxDigest(undefined);
         setIsWaitingForConfirmation(false);
         toast.info(`Initiating purchase for ${listing.metadata?.name || 'NFT'}...`);

        // 1. Find a suitable payment coin
        const paymentCoinId = await findPaymentCoin(client, account.address, listing.price);

        if (!paymentCoinId) {
            toast.error(`Could not find a suitable coin with at least ${formatBaseUnits(listing.price)} IOTA in your wallet.`);
            setActionListingId(null);
            setCurrentAction(null);
            return;
        }

        toast.info(`Using coin ${paymentCoinId.substring(0,10)}... for payment.`);

        // 2. Construct and sign transaction
        try {
            const tx = new Transaction();
            tx.setGasBudget(100_000_000); // Adjust gas budget

            tx.moveCall({
                target: `${marketplacePackageId}::marketplace::buyItem`, // Adjust module/function name
                arguments: [
                    // tx.object(marketplaceObjectId), // If marketplace obj ID is needed
                    tx.object(listing.listingId),    // The ID of the Listing object
                    tx.object(paymentCoinId),        // The ID of the payment coin object
                ],
                 typeArguments: [`${client.network.coinType}`], // Pass IOTA coin type or specific FT type
            });

            console.log("Constructed Buy Tx:", JSON.stringify(tx.raw));

            signAndExecuteTransaction(
                { transaction: tx },
                {
                    onSuccess: ({ digest }) => {
                        setActionTxDigest(digest);
                        toast.success(`Buy transaction submitted: ${digest}. Waiting for confirmation...`);
                        setIsWaitingForConfirmation(true); // Start polling
                    },
                    onError: (error: any) => {
                        console.error('Buy transaction failed:', error);
                        toast.error(`Buy failed: ${error.message || 'Unknown error'}`);
                        setActionListingId(null);
                        setCurrentAction(null);
                        setIsWaitingForConfirmation(false);
                    },
                }
            );
        } catch (error: any) {
            console.error('Error constructing buy transaction:', error);
            toast.error(`Transaction construction failed: ${error.message || 'Unknown error'}`);
            setActionListingId(null);
            setCurrentAction(null);
        }
    }, [client, account, marketplacePackageId, signAndExecuteTransaction, isTxPending, isWaitingForConfirmation]);

  // --- Cancel Listing Logic ---
     const handleCancel = useCallback((listing: CombinedListing) => {
        if (!client || !account || !marketplacePackageId) {
            toast.error("Client or account not available.");
            return;
        }
         if (isTxPending || isWaitingForConfirmation) return;

        setActionListingId(listing.listingId);
        setCurrentAction('cancel');
        setActionTxDigest(undefined);
        setIsWaitingForConfirmation(false);
        toast.info(`Initiating cancellation for listing ${listing.listingId.substring(0, 6)}...`);

        try {
            const tx = new Transaction();
            tx.setGasBudget(50_000_000); // Adjust gas budget

            tx.moveCall({
                target: `${marketplacePackageId}::marketplace::cancelListing`, // Adjust module/function name
                arguments: [
                     // tx.object(marketplaceObjectId), // If marketplace obj ID is needed
                     tx.object(listing.listingId),   // The ID of the Listing object to cancel
                ],
                 // typeArguments: []
            });

             console.log("Constructed Cancel Tx:", JSON.stringify(tx.raw));

            signAndExecuteTransaction(
                { transaction: tx },
                {
                    onSuccess: ({ digest }) => {
                        setActionTxDigest(digest);
                        toast.success(`Cancel transaction submitted: ${digest}. Waiting for confirmation...`);
                        setIsWaitingForConfirmation(true); // Start polling
                    },
                    onError: (error: any) => {
                        console.error('Cancel transaction failed:', error);
                        toast.error(`Cancellation failed: ${error.message || 'Unknown error'}`);
                        setActionListingId(null);
                        setCurrentAction(null);
                        setIsWaitingForConfirmation(false);
                    },
                }
            );
        } catch (error: any) {
             console.error('Error constructing cancel transaction:', error);
             toast.error(`Transaction construction failed: ${error.message || 'Unknown error'}`);
             setActionListingId(null);
             setCurrentAction(null);
        }
     }, [client, account, marketplacePackageId, signAndExecuteTransaction, isTxPending, isWaitingForConfirmation]);


    // --- Render Logic ---

  const handleLoadMore = () => {
        setDisplayCount(prev => Math.min(prev + ITEMS_PER_PAGE, listings.length));
  };

    const isLoadingAction = isTxPending || isWaitingForConfirmation;
    const activeListings = listings.filter(l => !l.fetchError);
    const erroredListings = listings.filter(l => l.fetchError);

  return (
    <TooltipProvider delayDuration={100}>
      <div className="space-y-6">
                <h1 className="text-3xl font-bold tracking-tight">IOTA Marketplace</h1>
        <p className="text-muted-foreground">
                    Browse and purchase items listed on the IOTA network.
        </p>

                {/* Loading Skeletons */}
                {isLoading && activeListings.length === 0 && erroredListings.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardHeader><Skeleton className="aspect-square rounded-md mb-2" /><Skeleton className="h-5 w-3/4 mb-1" /><Skeleton className="h-3 w-1/2" /></CardHeader>
                <CardContent><Skeleton className="h-3 w-full" /></CardContent>
                <CardFooter className="justify-end"><Skeleton className="h-8 w-16" /></CardFooter>
              </Card>
            ))}
          </div>
        )}

                {/* Loading Indicator Text (if loading but some items already shown) */}
                 {isLoading && (activeListings.length > 0 || erroredListings.length > 0) && (
                     <p className="text-center text-muted-foreground py-4">Loading more listing details...</p>
                 )}


                {/* Global Error Display */}
                {error && (
          <p className="text-center text-red-500">
                        Error: {error}
                        <Button onClick={loadMarketplaceData} variant="outline" size="sm" className="ml-2">Retry</Button>
          </p>
        )}

                {/* Listings Grid */}
                {!isLoading && activeListings.length === 0 && erroredListings.length === 0 && !error && (
                     <p className="text-center text-muted-foreground py-10">No active items found in the marketplace.</p>
                )}

                {(activeListings.length > 0 || erroredListings.length > 0) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {/* Display active listings */}
                        {activeListings.slice(0, displayCount).map((item) => {
                            const isActionInProgress = isLoadingAction && actionListingId === item.listingId;
                            const isOwnedByCurrentUser = account?.address && item.seller.toLowerCase() === account.address.toLowerCase();
                            const buttonAction = isOwnedByCurrentUser ? 'cancel' : 'buy';
                            const isCurrentAction = isActionInProgress && currentAction === buttonAction;

                            let buttonText = "Loading..."; // Default loading text
                            if (isOwnedByCurrentUser) {
                                buttonText = isCurrentAction ? "Cancelling..." : "Cancel Listing";
                            } else {
                                buttonText = isCurrentAction ? "Buying..." : "Buy Now";
                            }

                return (
                                <Card key={item.listingId}>
                    <CardHeader>
                      <div className="aspect-square bg-muted rounded-md mb-2 flex items-center justify-center overflow-hidden">
                         <img 
                                                src={item.metadata?.imageUrl || "/placeholder-nft.jpg"} // Use fetched URL or fallback
                                                alt={item.metadata?.name || `Token #${item.tokenId.substring(0, 6)}...`}
                              className="object-contain w-full h-full" 
                                                onError={(e) => (e.currentTarget.src = "/placeholder-nft.jpg")} // Fallback on image load error
                          />
                      </div>
                                        <CardTitle className="text-lg truncate" title={item.metadata?.name || `Token #${item.tokenId}`}>
                                            {item.metadata?.name || `Token #${item.tokenId.substring(0, 10)}...`}
                                        </CardTitle>
                      <CardDescription>
                                            Price: {item.formattedPrice}
                                            {/* Add USD price here if implemented later */}
                      </CardDescription> 
                    </CardHeader>
                    <CardContent>
                                        <p className="text-xs text-muted-foreground mb-1 line-clamp-2" title={item.metadata?.description}>
                                            {item.metadata?.description || "No description."}
                                        </p>
                        <Tooltip>
                          <TooltipTrigger asChild>
                             <p className="text-xs text-muted-foreground truncate cursor-help" title={item.seller}> 
                                                    Seller: {item.seller.substring(0, 10)}...{item.seller.substring(item.seller.length - 4)}
                              </p>
                          </TooltipTrigger>
                                            <TooltipContent><p>{item.seller}</p></TooltipContent>
                        </Tooltip>
                    </CardContent>
                    <CardFooter className="justify-end">
                       {isOwnedByCurrentUser ? (
                           <Tooltip>
                             <TooltipTrigger asChild>
                                                    <span> {/* Span needed for disabled button tooltip */}
                                 <Button 
                                   variant="destructive"
                                   size="sm" 
                                                            onClick={() => handleCancel(item)}
                                                            disabled={isLoadingAction || !account}
                                                            style={{ pointerEvents: (isLoadingAction || !account) ? 'none' : 'auto' }}
                                                        >
                                                            {buttonText}
                                 </Button> 
                               </span>
                             </TooltipTrigger>
                                                <TooltipContent><p>Remove this listing.</p></TooltipContent>
                           </Tooltip>
                       ) : (
                           <Tooltip>
                             <TooltipTrigger asChild>
                                                    <span> {/* Span needed for disabled button tooltip */}
                                 <Button 
                                   size="sm" 
                                                            onClick={() => handleBuy(item)}
                                                            disabled={isLoadingAction || !account}
                                                            style={{ pointerEvents: (isLoadingAction || !account) ? 'none' : 'auto' }}
                                                        >
                                                            {buttonText}
                                 </Button> 
                               </span>
                             </TooltipTrigger>
                                                <TooltipContent><p>Buy for {item.formattedPrice}</p></TooltipContent>
                            </Tooltip>
                       )}
                    </CardFooter>
                  </Card>
                );
              })}

                         {/* Display errored listings */}
                        {erroredListings.map(item => (
                            <Card key={item.listingId} className="border-destructive">
                                <CardHeader>
                                     <Skeleton className="aspect-square rounded-md mb-2" />
                                     <CardTitle className="text-lg truncate text-destructive">Load Error</CardTitle>
                                     <CardDescription>Listing ID: {item.listingId.substring(0, 10)}...</CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-xs text-destructive">{item.fetchError || "Unknown error"}</p>
                                </CardContent>
                                 <CardFooter/> {/* Empty footer to maintain layout */}
                            </Card>
                        ))}
            </div>
                )}

            
                {/* Load More Button */}
                {activeListings.length > displayCount && !isLoading && (
              <div className="text-center mt-6">
                        <Button onClick={handleLoadMore} variant="secondary" disabled={isLoading}>
                            Load More ({listings.length - displayCount} remaining)
                </Button>
        </div>
            )}

    </div>
    </TooltipProvider>
  );
}
