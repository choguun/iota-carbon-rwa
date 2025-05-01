'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useAccount, useReadContracts, useWriteContract, useWaitForTransactionReceipt, useWatchContractEvent } from 'wagmi';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton"; // Import Skeleton for loading state
import { toast } from "sonner"; // Assuming sonner is installed for toast notifications
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose // Optional: If using a close button inside
} from "@/components/ui/dialog";
import ListItemDialog from "@/components/marketplace/ListItemDialog"; // Import the new dialog component
import { decodeEventLog } from 'viem'; // Import decodeEventLog
import { 
    CARBON_CREDIT_NFT_ADDRESS, 
    REWARD_NFT_ADDRESS, 
    RETIREMENT_LOGIC_ADDRESS 
} from '@/config/contracts'; // Import addresses from config
import { ERC721_ABI, RETIREMENT_LOGIC_ABI, RETIREMENT_LOGIC_FULL_ABI } from '@/config/contracts';
interface NftMetadata {
    name?: string;
    description?: string;
    image?: string;
    // Add other potential attributes
}

interface OwnedNft {
    id: bigint; // tokenId
    contractAddress: `0x${string}`;
    tokenUri?: string;
    metadata?: NftMetadata;
    metadataError?: string;
    // Removed isLoading/error per item, handle loading/error globally for stages
}

// --- fetchMetadata Helper ---
async function fetchMetadata(tokenUri: string): Promise<{ metadata: NftMetadata | null; error?: string }> {
    if (!tokenUri) {
        return { metadata: null, error: "Token URI is empty." };
    }

    // 1. Check if it's the placeholder (handle gracefully)
    if (tokenUri === 'ipfs://METADATA_PLACEHOLDER') { 
        return { metadata: null, error: "Metadata not available (placeholder)." };
    }
    
    // --- NEW: Check for Base64 JSON data URI --- 
    const base64Prefix = "data:application/json;base64,";
    if (tokenUri.startsWith(base64Prefix)) {
        console.log("Handling Base64 JSON URI for:", tokenUri.substring(0, 60) + "...");
        try {
            const base64Data = tokenUri.substring(base64Prefix.length);
            const jsonString = Buffer.from(base64Data, 'base64').toString('utf-8');
            const metadata = JSON.parse(jsonString);
            // Basic validation
            if (typeof metadata === 'object' && metadata !== null) {
                return { metadata: metadata as NftMetadata };
            }
            return { metadata: null, error: "Invalid Base64 JSON metadata format" };
        } catch (e: any) {
            console.error("Failed to parse Base64 JSON metadata:", e);
            return { metadata: null, error: `Failed to parse Base64 JSON metadata: ${e.message}` };
        }
    }
    // --- END NEW CHECK --- 

    // 2. Check if it looks like a raw JSON string (On-Chain JSON)
    //    (This check might be less likely if Base64 is used, but keep for robustness)
    if (tokenUri.startsWith('{') && tokenUri.endsWith('}')) {
        console.log("Handling raw JSON URI for:", tokenUri.substring(0, 60) + "...");
        try {
            const metadata = JSON.parse(tokenUri);
            // Basic validation
            if (typeof metadata === 'object' && metadata !== null) {
                return { metadata: metadata as NftMetadata };
            }
            return { metadata: null, error: "Invalid on-chain raw JSON metadata format" };
        } catch (e: any) {
            console.error("Failed to parse on-chain raw JSON metadata:", e);
            return { metadata: null, error: `Failed to parse on-chain raw JSON metadata: ${e.message}` };
        }
    }

    // 3. Assume it's a URL (IPFS or HTTP)
    console.log("Handling URL URI:", tokenUri);
    const url = tokenUri.startsWith('ipfs://')
        ? `https://ipfs.io/ipfs/${tokenUri.split('ipfs://')[1]}`
        : tokenUri;
    
    try {
        // Use fetch with appropriate headers and error handling
        const response = await fetch(url, { 
             headers: { 'Accept': 'application/json, text/plain, */*' } // Accept JSON or text
        }); 
        if (!response.ok) {
             // Handle different error statuses specifically if needed
            throw new Error(`HTTP error fetching metadata! status: ${response.status}`);
        }

        const contentType = response.headers.get("content-type");

        // Attempt to parse response as JSON (for standard IPFS/HTTP metadata)
        if (contentType?.includes("application/json")) {
            const metadata = await response.json();
            if (typeof metadata === 'object' && metadata !== null) {
                 // Handle potential image IPFS URI within metadata
                if (metadata.image && metadata.image.startsWith('ipfs://')) {
                    metadata.image = `https://ipfs.io/ipfs/${metadata.image.split('ipfs://')[1]}`;
                }
                return { metadata: metadata as NftMetadata };
            }
             return { metadata: null, error: "Invalid JSON metadata format from URL" };
        }
        // Handle plain text or other data (like SVG)
        else {
             const textData = await response.text();
            if (textData.startsWith('data:image')) { // Handle data URIs (e.g., SVG)
                 return { metadata: { image: textData, name: `On-chain Image Data` } };
            }
            // If it's not JSON and not a known data URI, treat as unknown
            return { metadata: null, error: `Unsupported content type: ${contentType}` };
        } 
    } catch (error: any) {
        console.error("Failed to fetch or parse metadata from URL:", url, error);
        return { metadata: null, error: error.message || "Unknown metadata fetch error" };
    }
}
// --- End fetchMetadata Helper ---

export default function MyAssetsPage() {
    const { address, isConnected } = useAccount();
    const [fetchedNfts, setFetchedNfts] = useState<{ carbon: OwnedNft[], reward: OwnedNft[] }>({ carbon: [], reward: [] });
    const [isFetchingMetadata, setIsFetchingMetadata] = useState(false);
    const [globalError, setGlobalError] = useState<string | null>(null);
    const [retiringNftId, setRetiringNftId] = useState<bigint | null>(null); // Track which NFT is being retired
    const [isListDialogOpen, setIsListDialogOpen] = useState(false);
    const [nftToList, setNftToList] = useState<OwnedNft | null>(null);

    // 1. Read balances
    const balancesRead = useReadContracts({
        allowFailure: false, // Revert if any balance call fails
        contracts: [
            {
                address: CARBON_CREDIT_NFT_ADDRESS,
                abi: ERC721_ABI,
                functionName: 'balanceOf',
                args: [address!],
            },
            {
                address: REWARD_NFT_ADDRESS,
                abi: ERC721_ABI,
                functionName: 'balanceOf',
                args: [address!],
            },
        ],
        query: {
            enabled: isConnected && !!address,
            select: (data) => ({ // Simplify data structure
                carbonBalance: data[0] as bigint ?? BigInt(0),
                rewardBalance: data[1] as bigint ?? BigInt(0),
            })
        }
    });

    const { carbonBalance = BigInt(0), rewardBalance = BigInt(0) } = balancesRead.data ?? {};

    // 2. Prepare contract calls for tokenOfOwnerByIndex
    const tokenIndexCalls = useMemo(() => {
        if (!address || carbonBalance + rewardBalance === BigInt(0)) return [];
        const calls: any[] = [];
        for (let i = BigInt(0); i < carbonBalance; i++) {
            calls.push({
                address: CARBON_CREDIT_NFT_ADDRESS,
                abi: ERC721_ABI,
                functionName: 'tokenOfOwnerByIndex',
                args: [address, i],
            });
        }
        for (let i = BigInt(0); i < rewardBalance; i++) {
            calls.push({
                address: REWARD_NFT_ADDRESS,
                abi: ERC721_ABI,
                functionName: 'tokenOfOwnerByIndex',
                args: [address, i],
            });
        }
        return calls;
    }, [address, carbonBalance, rewardBalance]);

    // 3. Read Token IDs
    const tokenIdsRead = useReadContracts({
        allowFailure: true, // Allow individual failures
        contracts: tokenIndexCalls,
        query: {
            enabled: tokenIndexCalls.length > 0, // Only run if there are balances
            select: (data) => {
                // Process results, linking tokenId to contract address
                const results: { tokenId: bigint; contractAddress: `0x${string}`; error?: Error }[] = [];
                let carbonIdx = 0;
                let rewardIdx = 0;
                for (let i = 0; i < data.length; i++) {
                    const contractAddr = i < Number(carbonBalance) ? CARBON_CREDIT_NFT_ADDRESS : REWARD_NFT_ADDRESS;
                    if (data[i].status === 'success') {
                        results.push({ tokenId: data[i].result as bigint, contractAddress: contractAddr });
                    } else {
                        results.push({ tokenId: BigInt(-1), contractAddress: contractAddr, error: data[i].error }); // Mark error
                        console.error(`Failed to fetch token ID for ${contractAddr} index ${i < Number(carbonBalance) ? carbonIdx : rewardIdx}:`, data[i].error);
                    }
                    if (i < Number(carbonBalance)) carbonIdx++; else rewardIdx++;
                }
                return results;
            }
        }
    });

    const fetchedTokenIds = tokenIdsRead.data?.filter(item => item.tokenId !== BigInt(-1)) ?? [];

    // 4. Prepare contract calls for tokenURI
    const tokenUriCalls = useMemo(() => {
        if (fetchedTokenIds.length === 0) return [];
        return fetchedTokenIds.map(item => ({
            address: item.contractAddress,
            abi: ERC721_ABI,
            functionName: 'tokenURI',
            args: [item.tokenId],
        }));
    }, [fetchedTokenIds]);

    // 5. Read Token URIs
    const tokenUrisRead = useReadContracts({
        allowFailure: true, // Allow individual failures
        contracts: tokenUriCalls,
        query: {
            enabled: tokenUriCalls.length > 0,
            select: (data) => {
                // Combine tokenIds with their URIs or errors
                return fetchedTokenIds.map((item, index) => ({
                    ...item, // Includes tokenId, contractAddress
                    tokenUri: data[index].status === 'success' ? data[index].result as string : undefined,
                    metadataError: data[index].status !== 'success' ? (data[index].error?.message ?? "Failed to fetch URI") : undefined
                }));
            }
        }
    });

    // --- Hook for Retire Function --- 
    const { 
        data: retireTxHash, 
        isPending: isRetirePending, 
        error: retireError, 
        writeContract: retireNft 
    } = useWriteContract();

    // --- Hook to wait for Retire Tx Receipt --- 
    const { isLoading: isRetireTxLoading, isSuccess: isRetireTxSuccess } = useWaitForTransactionReceipt({ 
        hash: retireTxHash,
        query: { enabled: !!retireTxHash } // Only run when hash is available
    });

    // --- Handler to open the List Item dialog ---
    const handleOpenListDialog = (nft: OwnedNft) => {
        setNftToList(nft);
        setIsListDialogOpen(true);
    };

    // --- Handler for Retire Button Click ---
    const handleRetire = (nftContract: `0x${string}`, tokenId: bigint) => {
        if (!retireNft) {
            toast.error("Retire function not ready.");
            return;
        }
        setRetiringNftId(tokenId); // Set which NFT is currently being retired
        toast.info(`Initiating retirement for NFT #${tokenId}...`);
        
        retireNft({ 
            address: RETIREMENT_LOGIC_ADDRESS,
            abi: RETIREMENT_LOGIC_ABI, // Using fragment, ensure it defines retireNFT(uint256)
            functionName: 'retireNFT',
            args: [tokenId] // Pass only tokenId in an array
        }, {
            onSuccess: (hash) => {
                 toast.success(`Retirement transaction submitted: ${hash}`);
            },
            onError: (err: any) => { // Add basic type for err
                toast.error(`Retirement failed: ${err.shortMessage || err.message}`);
                setRetiringNftId(null); // Reset retiring ID on error
            }
        });
    };

    // --- Effect to show success/error messages for retire tx ---
    useEffect(() => {
        if (isRetireTxSuccess) {
            // toast.success(`NFT #${retiringNftId} successfully retired!`); // Can be commented out if event toast is preferred
            setRetiringNftId(null); // Reset retiring ID
            // Data refetch is now triggered by the event listener for better timing
            // balancesRead.refetch();
            // tokenIdsRead.refetch(); 
            // tokenUrisRead.refetch();
        }
        if (retireError) {
             // Error handled in onError callback of writeContract
        }
    }, [isRetireTxSuccess, retireError, retiringNftId /* Removed refetch dependencies */]);

    // --- Watch NFTRetired Event --- 
    useWatchContractEvent({
        address: RETIREMENT_LOGIC_ADDRESS,
        abi: RETIREMENT_LOGIC_FULL_ABI, // Use the full ABI with the event
        eventName: 'NFTRetired',
        onLogs(logs) {
          console.log('NFTRetired event received:', logs);
          logs.forEach((log: any) => { // Use any for now, refine type if needed
            try {
              const decodedLog = decodeEventLog({
                abi: RETIREMENT_LOGIC_FULL_ABI,
                data: log.data,
                topics: log.topics,
                eventName: 'NFTRetired' 
              });
              
              const args = decodedLog.args as {
                  user?: `0x${string}`;
                  tokenId?: bigint;
                  rewardTier?: bigint;
              };

              // Optional: Check if the event is for the current user
              if (args.user?.toLowerCase() === address?.toLowerCase()) {
                const message = `NFT #${args.tokenId?.toString()} retired! Reward Tier: ${args.rewardTier?.toString()}`;
                toast.success(message);

                // Refetch user's NFT data now that retirement is fully processed
                balancesRead.refetch();
                tokenIdsRead.refetch();
                tokenUrisRead.refetch();
              } else {
                // Log retirement by other users if desired
                console.log(`NFT #${args.tokenId?.toString()} retired by another user: ${args.user}`);
              }
              
            } catch (e) {
              console.error("Failed to decode NFTRetired event:", e, log);
            }
          });
        },
        onError(error) {
            console.error('Error watching NFTRetired event:', error);
            toast.error('Error listening for retirement events.');
        }
    });

    // 6. Fetch Metadata when URIs are ready
    useEffect(() => {
        const nftsWithUris = tokenUrisRead.data;
        if (!nftsWithUris || nftsWithUris.length === 0) {
            setFetchedNfts({ carbon: [], reward: [] }); // Reset if URIs are not loaded or empty
            setIsFetchingMetadata(false);
            return;
        }

        // Only fetch metadata if the URI data is fresh (avoid refetching on parent re-renders)
        if (!tokenUrisRead.isFetching && !isFetchingMetadata) {
            let isMounted = true;
            setIsFetchingMetadata(true);
            setGlobalError(null);

            Promise.all(nftsWithUris.map(async (nftInfo) => {
                if (!nftInfo.tokenUri) {
                    return { ...nftInfo, metadata: null }; // Keep existing metadata error if URI fetch failed
                }
                const { metadata, error } = await fetchMetadata(nftInfo.tokenUri);
                return { ...nftInfo, metadata, metadataError: error ?? nftInfo.metadataError }; // Combine errors
            })).then((results) => {
                if (isMounted) {
                    const finalCarbonNfts: OwnedNft[] = [];
                    const finalRewardNfts: OwnedNft[] = [];
                    results.forEach(nft => {
                        const finalNft: OwnedNft = {
                            id: nft.tokenId,
                            contractAddress: nft.contractAddress,
                            tokenUri: nft.tokenUri,
                            metadata: nft.metadata ?? undefined,
                            metadataError: nft.metadataError
                        };
                        if (nft.contractAddress === CARBON_CREDIT_NFT_ADDRESS) {
                            finalCarbonNfts.push(finalNft);
                        } else {
                            finalRewardNfts.push(finalNft);
                        }
                    });
                    setFetchedNfts({ carbon: finalCarbonNfts, reward: finalRewardNfts });
                    setIsFetchingMetadata(false);
                }
            }).catch(err => {
                 // Should not happen with Promise.all unless fetchMetadata throws unexpectedly
                 console.error("Unexpected error fetching metadata batch:", err);
                 if (isMounted) {
                     setGlobalError("Unexpected error processing metadata.");
                     setIsFetchingMetadata(false);
                 }
            });

            return () => { isMounted = false; };
        }
    }, [tokenUrisRead.data, tokenUrisRead.isFetching, isFetchingMetadata]); // Rerun when URI data changes

    const isInitialLoading = balancesRead.isLoading || tokenIdsRead.isLoading;
    const isDetailLoading = !isInitialLoading && (tokenUrisRead.isLoading || isFetchingMetadata);
    const combinedError = globalError || balancesRead.error?.message || tokenIdsRead.error?.message || tokenUrisRead.error?.message;

    if (!isConnected) {
        return <p className="text-center text-muted-foreground">Please connect your wallet to view your assets.</p>;
    }

    // Helper to render NFT cards
    const renderNftCard = (nft: OwnedNft) => {
        const isCurrentlyRetiring = isRetirePending && retiringNftId === nft.id;
        const isCurrentlyListing = !!nftToList; // Check if the list dialog is targeting *any* NFT
        
        // --- Determine placeholder image based on contract address --- 
        const placeholderImageSrc = nft.contractAddress === REWARD_NFT_ADDRESS 
            ? "/placeholder-reward-nft.jpg" 
            : "/placeholder-nft.jpg";
        
        return (
            <Card key={`${nft.contractAddress}-${nft.id}`}>
                <CardHeader>
                    <div className="aspect-square bg-muted rounded-md mb-2 flex items-center justify-center overflow-hidden">
                         <img 
                            // Use the determined placeholder image source
                            src={placeholderImageSrc} 
                            alt={nft.metadata?.name || `Token #${nft.id}`}
                            className="object-contain w-full h-full" 
                            // Add error handling for image loading if desired
                            // onError={(e) => (e.currentTarget.src = '/fallback-image.jpg')} 
                         />
                    </div>
                    <CardTitle className="text-lg truncate">{nft.metadata?.name || `Token #${nft.id}`}</CardTitle>
                    <CardDescription className="text-xs truncate"> {nft.metadata?.description || "No description."}</CardDescription>
                </CardHeader>
                <CardContent>
                    <p className="text-xs text-muted-foreground truncate" title={nft.contractAddress}>
                        {nft.contractAddress === CARBON_CREDIT_NFT_ADDRESS ? "Carbon Credit" : "Reward NFT"} #{nft.id.toString()}
                    </p>
                    {nft.metadataError && <p className="text-xs text-destructive">Error: {nft.metadataError}</p>}
                </CardContent>
                <CardFooter className="justify-end space-x-2">
                    {nft.contractAddress === CARBON_CREDIT_NFT_ADDRESS && (
                        <>
                            {/* List Button */}
                            <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleOpenListDialog(nft)}
                                disabled={isCurrentlyRetiring || isRetireTxLoading || isListDialogOpen}
                            >
                                List
                            </Button>
                            {/* Retire Button */}
                            <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleRetire(nft.contractAddress, nft.id)}
                                disabled={isCurrentlyRetiring || isRetireTxLoading || isRetirePending || isListDialogOpen}
                            >
                                {isCurrentlyRetiring ? "Retiring..." : "Retire"}
                            </Button>
                        </>
                    )}
                    {/* Add logic here if Reward NFTs have actions */} 
                </CardFooter>
            </Card>
        );
    }

    // Loading Skeleton
    const renderSkeletonCard = (key: number) => (
         <Card key={key}>
            <CardHeader>
                <Skeleton className="aspect-square rounded-md mb-2" />
                <Skeleton className="h-5 w-3/4 mb-1" />
                 <Skeleton className="h-3 w-1/2" />
            </CardHeader>
            <CardContent>
                <Skeleton className="h-3 w-full" />
            </CardContent>
            <CardFooter className="justify-end">
                <Skeleton className="h-8 w-16" />
            </CardFooter>
        </Card>
    );

    return (
        <div className="space-y-6">
            <h1 className="text-3xl font-bold tracking-tight">My Assets</h1>
            <p className="text-muted-foreground">
                View your collected Carbon Credit NFTs and Reward NFTs.
            </p>

            {combinedError && (
                <p className="text-center text-red-500">
                   Error fetching assets: {combinedError}
                </p>
            )}

            {/* Carbon Credit NFTs Section */}
            <div className="space-y-4">
                <h2 className="text-2xl font-semibold tracking-tight">My Carbon Credits ({isInitialLoading ? "..." : carbonBalance.toString()})</h2>
                {isInitialLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {Array.from({ length: Number(carbonBalance > 0 ? carbonBalance : 2) }).map((_, i) => renderSkeletonCard(i))}
                    </div>
                ) : isDetailLoading ? (
                    <p className="text-center text-muted-foreground py-4">Loading details for your Carbon Credits...</p>
                ) : !combinedError && fetchedNfts.carbon.length === 0 ? (
                    <p className="text-muted-foreground">You currently don't own any Carbon Credit NFTs.</p>
                ) : !combinedError && fetchedNfts.carbon.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {fetchedNfts.carbon.map(renderNftCard)}
                    </div>
                ) : null}
            </div>

            {/* Reward NFTs Section */}
            <div className="space-y-4">
                <h2 className="text-2xl font-semibold tracking-tight">My Reward NFTs ({isInitialLoading ? "..." : rewardBalance.toString()})</h2>
                 {isInitialLoading ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                         {Array.from({ length: Number(rewardBalance > 0 ? rewardBalance : 2) }).map((_, i) => renderSkeletonCard(1000 + i))}
                    </div>
                ) : isDetailLoading ? (
                    <p className="text-center text-muted-foreground py-4">Loading details for your Reward NFTs...</p>
                ) : !combinedError && fetchedNfts.reward.length === 0 ? (
                    <p className="text-muted-foreground">You currently don't own any Reward NFTs.</p>
                ) : !combinedError && fetchedNfts.reward.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                        {fetchedNfts.reward.map(renderNftCard)}
                    </div>
                ) : null}
            </div>

            {/* List Item Dialog */}
            <Dialog open={isListDialogOpen} onOpenChange={setIsListDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>List NFT for Sale</DialogTitle>
                        <DialogDescription>
                            Set the price in C2FLR for your Carbon Credit NFT.
                            The Marketplace contract will need approval to transfer this NFT.
                        </DialogDescription>
                    </DialogHeader>
                    {nftToList && (
                         <ListItemDialog
                            nft={nftToList}
                            onListingComplete={() => {
                                setIsListDialogOpen(false); // Close dialog on success
                                // Optional: trigger refetch? Maybe handled by event listener later
                            }}
                         />
                     )}
                </DialogContent>
            </Dialog>

        </div>
    );
} 