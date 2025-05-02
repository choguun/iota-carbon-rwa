import {
    useIotaClient,
    useSignAndExecuteTransaction,
    useCurrentAccount, // Assuming dapp-kit provides this or similar for connected address
} from '@iota/dapp-kit';
import { Transaction } from '@iota/iota-sdk/transactions';
import { useNetworkVariable } from '@/lib/networkConfig'; // Assuming this exists
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import React, { useState, useEffect, useCallback } from 'react';
import type { TransactionId } from '@iota/sdk'; // Use TransactionId

// Passed from MyAssetsPage - Assuming NftData now uses IOTA Object ID (string)
interface NftData {
    id: string; // IOTA Object ID
    metadata?: { name?: string }; // Keep basic metadata if available pre-listing
    // Potentially add nftPackageId if needed, or get from config
}

interface ListItemDialogProps {
    nft: NftData;
    onListingComplete: () => void;
    marketplacePackageId: string; // Pass the package ID where the marketplace module resides
}

// Helper to convert display amount to base units (assuming 6 decimals like IOTA)
const toBaseUnits = (amount: string, decimals: number = 6): bigint => {
    try {
        const parts = amount.split('.');
        const integerPart = parts[0];
        const fractionalPart = parts[1] || '';
        const paddedFractional = fractionalPart.padEnd(decimals, '0');
        return BigInt(integerPart + paddedFractional);
    } catch (e) {
        console.error("Error parsing amount:", e);
        return BigInt(0); // Or throw error / handle invalid input
    }
};


export default function ListItemDialog({ nft, onListingComplete, marketplacePackageId }: ListItemDialogProps) {
    const [price, setPrice] = useState('');
    const [isListing, setIsListing] = useState(false);
    const [listingTxDigest, setListingTxDigest] = useState<TransactionId | undefined>(); // Use TransactionId

    const account = useCurrentAccount(); // Get connected account info
    const client = useIotaClient();
    const { mutate: signAndExecuteTransaction, isPending: isTxPending } = useSignAndExecuteTransaction();

    // Network config (replace with actual hook/config)
    // const marketplacePackageId = useNetworkVariable('marketplacePackageId');

    // State to track transaction confirmation polling
    const [isWaitingForConfirmation, setIsWaitingForConfirmation] = useState(false);

    const handleList = () => {
        if (!marketplacePackageId || marketplacePackageId === 'PLACEHOLDER_MARKETPLACE_PACKAGE_ID') {
            toast.error("Marketplace Package ID not configured.");
            return;
        }
        if (!client) {
            toast.error("IOTA client not available.");
            return;
        }
        if (!account) {
            toast.error("Please connect your wallet.");
            return;
        }
        if (!price || isNaN(parseFloat(price)) || parseFloat(price) <= 0) {
            toast.error("Please enter a valid positive price.");
            return;
        }
        // TODO: Determine the correct price format/units expected by the contract
        // Assuming the contract expects the price in base units (e.g., microIOTA if using native token)
        // Or potentially a specific Fungible Token type
        let priceBaseUnits: bigint;
        try {
            // Assuming 6 decimals for price representation (like IOTA) - ADJUST AS NEEDED
            priceBaseUnits = toBaseUnits(price, 6);
            if (priceBaseUnits <= BigInt(0)) {
                 toast.error("Price must be positive.");
                 return;
            }
        } catch (e) {
            toast.error("Invalid price format.");
            return;
        }


        setIsListing(true);
        setListingTxDigest(undefined);
        setIsWaitingForConfirmation(false);
        toast.info(`Listing NFT ${nft.metadata?.name || nft.id} for ${price} TOKEN...`); // Adjust TOKEN name

        try {
            const tx = new Transaction();
            tx.setGasBudget(50_000_000); // Adjust gas budget as needed

            // Construct the arguments based on the `listItem` function signature in your Move contract
            // list_item(nft: CarbonCreditNFT, price_micro_iota: u64)
            // Arguments might involve object IDs or pure values
            tx.moveCall({
                target: `${marketplacePackageId}::marketplace::list_item`, // Use correct function name
                arguments: [
                    tx.object(nft.id),             // Argument 0: The NFT object (by ID)
                    tx.pure.u64(priceBaseUnits)    // Argument 1: The price (u64)
                ],
                // typeArguments: [] // If the function has type arguments
            });

            signAndExecuteTransaction(
                {
                    transaction: tx,
                    // chain: client.chain, // Might be needed depending on dapp-kit version
                },
                {
                    onSuccess: ({ digest }: { digest: TransactionId }) => {
                        setListingTxDigest(digest);
                        toast.success(`Listing transaction submitted: ${digest}. Waiting for confirmation...`);
                        setIsWaitingForConfirmation(true); // Start polling
                    },
                    onError: (error: any) => {
                        console.error('Failed to execute listing transaction', error);
                        toast.error(`Listing failed: ${error.message || 'Unknown error'}`);
                        setIsListing(false);
                        setIsWaitingForConfirmation(false);
                    },
                }
            );
        } catch (error: any) {
             console.error('Error constructing listing transaction:', error);
             toast.error(`Transaction construction failed: ${error.message || 'Unknown error'}`);
             setIsListing(false);
        }
    };

    // Effect to poll for transaction confirmation
    useEffect(() => {
        if (!listingTxDigest || !isWaitingForConfirmation || !client) {
            return;
        }

        let intervalId: NodeJS.Timeout | undefined;
        let attempts = 0;
        const maxAttempts = 30; // Poll for ~ 1 minute (30 * 2s)

        const poll = async () => {
             console.log(`Polling transaction ${listingTxDigest}, attempt ${attempts + 1}`);
            attempts++;
            try {
                // Use getTransactionBlock with digest
                const txDetails = await client.getTransactionBlock({ digest: listingTxDigest });
 
                // Check status based on SDK structure - VERIFY THIS PATH
                const status = (txDetails as any)?.effects?.status?.status; // Example path, adjust as needed
 
                if (status === 'success') {
                    toast.success(`NFT ${nft.metadata?.name || nft.id} listed successfully! Digest: ${listingTxDigest}`);
                    setIsListing(false);
                    setIsWaitingForConfirmation(false);
                    onListingComplete(); // Call the callback
                    clearInterval(intervalId);
                } else if (status === 'failure') {
                     const errorMsg = (txDetails as any)?.effects?.status?.error || 'Unknown reason';
                     console.error(`Listing transaction ${listingTxDigest} failed:`, errorMsg);
                     toast.error(`Listing transaction failed: ${errorMsg}`);
                     setIsListing(false);
                     setIsWaitingForConfirmation(false);
                     clearInterval(intervalId);
                }
                // else: status is pending, continue polling

            } catch (error) {
                console.error(`Error polling transaction ${listingTxDigest}:`, error);
                 // Decide if polling should stop on error or continue
                 if (attempts >= maxAttempts) {
                     toast.error(`Failed to get confirmation status for ${listingTxDigest} after ${maxAttempts} attempts.`);
                     setIsListing(false);
                     setIsWaitingForConfirmation(false);
                     clearInterval(intervalId);
                 }
            }
        };

        // Start polling immediately and then set interval
        poll();
        intervalId = setInterval(poll, 2000); // Poll every 2 seconds

        // Cleanup function
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [listingTxDigest, isWaitingForConfirmation, client, onListingComplete, nft.id, nft.metadata?.name]);


    const isLoading = isTxPending || isWaitingForConfirmation;

    return (
        <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="nft-name" className="text-right">
                    NFT
                </Label>
                {/* Display NFT ID clearly as it's the primary identifier */}
                <span id="nft-name" className="col-span-3 truncate text-sm" title={nft.id}>
                    {nft.metadata?.name || `Object ID`} : {nft.id.substring(0, 6)}...{nft.id.substring(nft.id.length - 4)}
                </span>
            </div>
            <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="price" className="text-right">
                    Price {/* TODO: Specify Token (e.g., IOTA) */}
                </Label>
                <Input
                    id="price"
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="col-span-3"
                    placeholder="e.g., 10.5" // Adjust placeholder based on token
                    disabled={isLoading}
                    step="any" // Allow decimals
                />
            </div>
            <div className='flex justify-end space-x-2 mt-4'>
                 {/* Single List button */}
                 <Button
                    onClick={handleList}
                    disabled={isLoading || !account} // Disable if loading or wallet not connected
                 >
                    {isTxPending ? 'Check Wallet...' : isWaitingForConfirmation ? 'Confirming...' : 'List Item'}
                 </Button>
            </div>
            {!account && <p className="text-xs text-red-500 text-center mt-2">Please connect your wallet to list.</p>}
        </div>
    );
}