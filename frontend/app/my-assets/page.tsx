'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    useIotaClient,
    useSignAndExecuteTransaction,
    useCurrentAccount,
} from '@iota/dapp-kit';
import { Transaction } from '@iota/iota-sdk/transactions';
import type { TransactionDigest, IObjectInfo } from '@iota/sdk'; // Adjust imports if needed
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  // DialogDescription, // Not used directly for ListItemDialog
  DialogHeader,
  DialogTitle,
  // DialogTrigger, // Trigger is handled manually
  // DialogFooter,
  // DialogClose
} from "@/components/ui/dialog";
import ListItemDialog from "@/components/marketplace/ListItemDialog"; // Import the IOTA-refactored dialog
import { useNetworkVariable } from '@/lib/networkConfig'; // Assuming this exists


// --- IOTA Data Structures ---

// Reusing NftObjectData from Marketplace refactor
interface NftObjectData {
     objectId: string; // Object ID is the primary identifier
     content?: {
        type?: string; // e.g., "0xPACKAGE::module::NftType"
        fields?: { [key: string]: any; };
    },
    display?: {
        data?: {
             name?: string;
             description?: string;
             image_url?: string;
        }
    }
}

// Simplified structure for owned assets display
interface OwnedNftDisplayData {
    id: string; // IOTA Object ID
    metadata?: {
        name?: string;
        description?: string;
        imageUrl?: string;
    };
    // Store raw type for filtering or display if needed
    type?: string;
    fetchError?: string; // Error specific to fetching this object
}


// --- Component ---

export default function MyAssetsPage() {
    const account = useCurrentAccount();
    const client = useIotaClient();
    const { mutate: signAndExecuteTransaction, isPending: isTxPending } = useSignAndExecuteTransaction();

    // Config
    const nftPackageId = useNetworkVariable('nftPackageId'); // Assuming one package for NFTs for now
    const carbonNftType = `${nftPackageId}::carbon_nft::CarbonCreditNFT`; // Example type string
    const rewardNftType = `${nftPackageId}::reward_nft::RewardNFT`; // Example type string
    const marketplacePackageId = useNetworkVariable('marketplacePackageId');

    // State
    const [ownedNfts, setOwnedNfts] = useState<OwnedNftDisplayData[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Retirement State
    const [retiringNftId, setRetiringNftId] = useState<string | null>(null);
    const [retirementTxDigest, setRetirementTxDigest] = useState<TransactionDigest | undefined>();
    const [isWaitingForRetireConfirm, setIsWaitingForRetireConfirm] = useState(false);

    // Listing State
    const [isListDialogOpen, setIsListDialogOpen] = useState(false);
    const [nftToList, setNftToList] = useState<OwnedNftDisplayData | null>(null);


    // --- Data Fetching Logic ---

    const fetchObjectsBatch = useCallback(async (objectIds: string[]): Promise<Map<string, IObjectInfo | null>> => {
        // (Identical to the fetchObjectsBatch in MarketplacePage refactor - can be moved to a util)
         const results = new Map<string, IObjectInfo | null>();
        if (!client || objectIds.length === 0) return results;
        console.log("Fetching object details for:", objectIds);
        try {
            for (const id of objectIds) {
                try {
                    const response = await client.getObject({ objectId: id, options: { showContent: true, showDisplay: true } });
                    results.set(id, response || null);
                } catch (individualError) {
                    console.warn(`Failed to fetch object ${id}:`, individualError);
                    results.set(id, null);
                }
            }
        } catch (batchError: any) {
            console.error("Error during sequential object fetching:", batchError);
            objectIds.forEach(id => results.set(id, null));
            setError(prev => prev ? `${prev}\nFailed to fetch object details: ${batchError.message}` : `Failed to fetch object details: ${batchError.message}`); // Append or set error
        }
        return results;
    }, [client]);


    const fetchOwnedNfts = useCallback(async () => {
        if (!client || !account?.address || !nftPackageId) {
            setOwnedNfts([]);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        setError(null);
        setOwnedNfts([]); // Clear previous results
        console.log(`Fetching owned NFTs for ${account.address}...`);

        let ownedObjectIds: string[] = [];

        try {
            // --- Replace with your actual fetching logic for owned object IDs ---
            // Option A: Indexer Query (Ideal if available)
            // Example:
            // const response = await fetch(`${indexerUrl}/owners/${account.address}/objects?type=${nftPackageId}::*`); // Adjust API endpoint/params
            // if (!response.ok) throw new Error(`Indexer query failed: ${response.statusText}`);
            // const data = await response.json();
            // ownedObjectIds = data.items?.map((item: any) => item.objectId) || [];

            // Option B: Client Method (If exists and is efficient enough)
             const response = await client.getOwnedObjects({ ownerAddress: account.address }); // Replace with actual method if it exists
             if (response?.items) {
                 // Filter client-side by type (less efficient if many objects)
                 ownedObjectIds = response.items
                     .map((item: any) => item?.objectId) // Extract objectId if structure is different
                     .filter(Boolean); // Filter out undefined/null
                  console.log(`Found ${ownedObjectIds.length} raw objects owned by ${account.address}`);
             } else {
                 console.log("No owned objects found via client method.");
                 ownedObjectIds = [];
             }


            // Option C: View Function (If your contract tracks ownership explicitly)
            // const result = await client.callViewFunction({ packageId: registryPackageId, module: 'registry', function: 'get_nfts_for_owner', args: [account.address] });
            // ownedObjectIds = result?.value || [];

             if (ownedObjectIds.length === 0) {
                 console.log("No relevant object IDs found for owner.");
                 setIsLoading(false);
                 setOwnedNfts([]);
                 return;
             }
             console.log("Potential Owned NFT Object IDs:", ownedObjectIds);

        } catch (err: any) {
            console.error("Error fetching owned object IDs:", err);
            setError(`Failed to get list of owned objects: ${err.message}`);
            setIsLoading(false);
            setOwnedNfts([]);
            return;
        }

        // Fetch details for the potential object IDs
        const objectsMap = await fetchObjectsBatch(ownedObjectIds);
        const processedNfts: OwnedNftDisplayData[] = [];

        objectsMap.forEach((objectInfo, objectId) => {
            if (!objectInfo || !objectInfo.data) {
                 // Silently ignore objects that failed to fetch, error logged in fetchObjectsBatch
                // Or add a specific error entry: processedNfts.push({ id: objectId, fetchError: "Failed to fetch details" });
                return;
            }

            const nftData = objectInfo.data as NftObjectData;
            // Add objectId explicitly if not present from getObject response structure
             if (!nftData.objectId) nftData.objectId = objectId;

            // Filter by type - adjust type strings as needed
            const type = nftData.content?.type;
            if (type && (type.includes('::carbon_nft::') || type.includes('::reward_nft::'))) { // Adjust filtering logic
                 const displayData = nftData.display?.data;
                 processedNfts.push({
                    id: objectId,
                    type: type,
                    metadata: {
                        name: displayData?.name || `Object ${objectId.substring(0, 6)}...`,
                        description: displayData?.description,
                        imageUrl: displayData?.image_url,
                    }
                 });
            } else {
                 // Log objects owned but not matching the expected NFT types (optional)
                 console.log(`Skipping object ${objectId} of type ${type}`);
            }
        });

        console.log("Processed owned NFTs:", processedNfts);
        setOwnedNfts(processedNfts);
        setIsLoading(false);
        // Clear error if processing was successful, even if some individual fetches failed silently
        // setError(null); // Or keep partial errors if needed

    }, [client, account?.address, nftPackageId, fetchObjectsBatch]); // Add fetchObjectsBatch dependency

    // Initial fetch and refetch on account change
    useEffect(() => {
        if (account?.address && client) {
            fetchOwnedNfts();
        } else {
            setOwnedNfts([]); // Clear if disconnected
        }
    }, [account?.address, client, fetchOwnedNfts]);


    // --- Retirement Confirmation Polling ---
     useEffect(() => {
        // (Similar polling logic as in MarketplacePage, using retirementTxDigest & setIsWaitingForRetireConfirm)
         if (!retirementTxDigest || !isWaitingForRetireConfirm || !client) return;

         let intervalId: NodeJS.Timeout | undefined;
         // ... (rest of polling logic: call client.getTransaction, check status) ...

         // On success:
         // toast.success(`NFT ${retiringNftId?.substring(0,6)}... retired successfully!`);
         // setIsWaitingForRetireConfirm(false);
         // setRetirementTxDigest(undefined);
         // setRetiringNftId(null);
         // fetchOwnedNfts(); // Refresh list

         // On timeout/failure:
         // toast.error(...) or toast.warning(...)
         // setIsWaitingForRetireConfirm(false);
         // setRetirementTxDigest(undefined);
         // setRetiringNftId(null); // Allow user to try again

         return () => clearInterval(intervalId); // Cleanup
     }, [retirementTxDigest, isWaitingForRetireConfirm, client, fetchOwnedNfts, retiringNftId]);


    // --- Actions ---

    const handleOpenListDialog = (nft: OwnedNftDisplayData) => {
        setNftToList(nft);
        setIsListDialogOpen(true);
    };

    const handleListingComplete = () => {
        setIsListDialogOpen(false);
        setNftToList(null);
        toast.success("NFT listed! Refreshing your assets...");
        fetchOwnedNfts(); // Refetch assets after listing
    };

    const handleRetire = useCallback((nftId: string) => {
        if (!client || !account || !nftPackageId || isTxPending || isWaitingForRetireConfirm) {
            return;
        }

        setRetiringNftId(nftId);
        setRetirementTxDigest(undefined);
        setIsWaitingForRetireConfirm(false);
        toast.info(`Initiating retirement for NFT ${nftId.substring(0, 6)}...`);

        try {
            const tx = new Transaction();
             // Adjust gas based on expected complexity of retire function
             // Might involve burning the NFT, updating logs, etc.
            tx.setGasBudget(50_000_000);

            // --- Adapt the moveCall based on your IOTA contract's retire function ---
            // Example: Assuming a function in the NFT's own module
            tx.moveCall({
                 // Target could be nftPackageId::module::retire_nft
                 // Or maybe a central retirement_logic::retire function
                target: `${nftPackageId}::carbon_nft::retire_nft`, // Adjust target function
                arguments: [
                    tx.object(nftId), // Pass the NFT object itself
                    // Add other arguments if required by your retire function
                    // E.g., tx.object(retirementLogObjectId) if updating a shared log
                ],
                 // typeArguments: [] // If needed
            });
            // --- End adaptation section ---

            console.log("Constructed Retire Tx:", JSON.stringify((tx as any).raw || tx)); // Attempt to log raw tx

            signAndExecuteTransaction(
                { transaction: tx },
                {
                    onSuccess: ({ digest }) => {
                        setRetirementTxDigest(digest);
                        toast.success(`Retirement transaction submitted: ${digest}. Waiting for confirmation...`);
                        setIsWaitingForRetireConfirm(true);
                    },
                    onError: (error: any) => {
                        console.error('Retire transaction failed:', error);
                        toast.error(`Retirement failed: ${error.message || 'Unknown error'}`);
                        setRetiringNftId(null);
                        setIsWaitingForRetireConfirm(false);
                    },
                }
            );
        } catch (error: any) {
            console.error('Error constructing retire transaction:', error);
            toast.error(`Transaction construction failed: ${error.message || 'Unknown error'}`);
            setRetiringNftId(null);
        }
    }, [client, account, nftPackageId, signAndExecuteTransaction, isTxPending, isWaitingForRetireConfirm]);


    // --- Render Logic ---

    const isLoadingAction = isTxPending || isWaitingForRetireConfirm;

    const renderNftCard = (nft: OwnedNftDisplayData) => {
        const isRetiringThis = isLoadingAction && retiringNftId === nft.id;
        // Determine if NFT is 'carbon' or 'reward' based on type string (adjust logic if needed)
        const isCarbonCredit = nft.type?.includes('::carbon_nft::');
        // Only allow listing Carbon Credits (example logic)
        const canList = isCarbonCredit;
        // Only allow retiring Carbon Credits (example logic)
        const canRetire = isCarbonCredit;

        return (
            <Card key={nft.id}>
                <CardHeader>
                    <div className="aspect-square bg-muted rounded-md mb-2 flex items-center justify-center overflow-hidden">
                         <img
                            src={nft.metadata?.imageUrl || "/placeholder-nft.jpg"}
                            alt={nft.metadata?.name || `Object #${nft.id.substring(0, 6)}...`}
                            className="object-contain w-full h-full"
                            onError={(e) => (e.currentTarget.src = "/placeholder-nft.jpg")}
                        />
                    </div>
                     <CardTitle className="text-lg truncate" title={nft.metadata?.name || `Object #${nft.id}`}>
                        {nft.metadata?.name || `Object #${nft.id.substring(0, 10)}...`}
                    </CardTitle>
                    <CardDescription className="text-xs truncate" title={nft.id}>
                        ID: {nft.id}
                    </CardDescription>
                     {/* Optionally display type */}
                     {/* <CardDescription className="text-xs">{nft.type?.split('::').pop()}</CardDescription> */}
                </CardHeader>
                <CardContent>
                     <p className="text-xs text-muted-foreground mb-1 line-clamp-2" title={nft.metadata?.description}>
                         {nft.metadata?.description || "No description available."}
                     </p>
                     {nft.fetchError && <p className="text-xs text-destructive">Error: {nft.fetchError}</p>}
                </CardContent>
                <CardFooter className="justify-end space-x-2">
                     {canRetire && (
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleRetire(nft.id)}
                            disabled={isLoadingAction}
                        >
                            {isRetiringThis ? "Retiring..." : "Retire"}
                        </Button>
                     )}
                     {canList && (
                         <Button
                             variant="default"
                             size="sm"
                             onClick={() => handleOpenListDialog(nft)}
                             disabled={isLoadingAction} // Disable while any action is pending
                         >
                             List for Sale
                         </Button>
                      )}
                     {/* Add other buttons for Reward NFTs if applicable */}
                     {!canList && !canRetire && (
                         <span className="text-xs text-muted-foreground">No actions available</span>
                     )}
                </CardFooter>
            </Card>
        );
    };

    const renderSkeletonCard = (key: number) => (
         <Card key={key}>
            <CardHeader><Skeleton className="aspect-square rounded-md mb-2" /><Skeleton className="h-5 w-3/4 mb-1" /><Skeleton className="h-3 w-1/2" /></CardHeader>
            <CardContent><Skeleton className="h-3 w-full mb-1" /><Skeleton className="h-3 w-2/3" /></CardContent>
            <CardFooter className="justify-end"><Skeleton className="h-8 w-16" /><Skeleton className="h-8 w-16 ml-2" /></CardFooter>
        </Card>
    );


    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">My Assets</h1>
            <p className="text-muted-foreground">
                View your collected Carbon Credit and Reward NFTs on the IOTA network.
            </p>

             {!account && (
                 <p className="text-center text-muted-foreground py-10">Please connect your wallet to view your assets.</p>
             )}

             {account && isLoading && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {Array.from({ length: 4 }).map((_, i) => renderSkeletonCard(i))}
                </div>
             )}

             {account && !isLoading && error && (
                 <p className="text-center text-red-500 py-10">
                     Error loading assets: {error}
                     <Button onClick={fetchOwnedNfts} variant="outline" size="sm" className="ml-2">Retry</Button>
                 </p>
             )}

            {account && !isLoading && !error && ownedNfts.length === 0 && (
                <p className="text-center text-muted-foreground py-10">You do not own any tracked NFT assets.</p>
            )}

            {account && !isLoading && !error && ownedNfts.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {ownedNfts.map(renderNftCard)}
                </div>
            )}

             {/* Listing Dialog */}
             <Dialog open={isListDialogOpen} onOpenChange={setIsListDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                         <DialogTitle>List Your NFT for Sale</DialogTitle>
                     </DialogHeader>
                     {nftToList && marketplacePackageId && (
                         <ListItemDialog
                             // Pass the NFT data needed by the dialog
                             // Ensure ListItemDialog expects `id` as string (Object ID)
                             nft={{ id: nftToList.id, metadata: nftToList.metadata }}
                             marketplacePackageId={marketplacePackageId} // Pass needed config
                             onListingComplete={handleListingComplete}
                         />
                      )}
                     {!nftToList && <p>Error: No NFT selected for listing.</p>}
                     {!marketplacePackageId && <p>Error: Marketplace configuration missing.</p>}
                 </DialogContent>
             </Dialog>

        </div>
    );
}