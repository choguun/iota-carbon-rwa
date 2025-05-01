import React from 'react';
import Image from 'next/image';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

// Define the properties the NFTCard component will accept
interface NFTCardProps {
  tokenId: string | number;
  name?: string; // Optional name from metadata
  imageUrl?: string; // Optional image URL from metadata
  description?: string; // Optional description
  price?: string; // Optional price (e.g., "100 FLR") for marketplace context
  actionButtonLabel?: string; // Optional label for a button (e.g., "Buy", "Retire")
  onActionClick?: () => void; // Optional handler for the button click
  showOwner?: boolean; // Flag to show owner info (if available)
  owner?: string; // Optional owner address
}

const NFTCard: React.FC<NFTCardProps> = ({
  tokenId,
  name = "Carbon Credit NFT", // Default name
  imageUrl,
  description,
  price,
  actionButtonLabel,
  onActionClick,
  showOwner,
  owner
}) => {
  const defaultImage = "/placeholder-nft.svg"; // Path to a placeholder image

  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-0">
        <div className="aspect-square relative bg-muted overflow-hidden">
          <Image 
            src={imageUrl || defaultImage}
            alt={name || `NFT #${tokenId}`}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            onError={(e) => { e.currentTarget.src = defaultImage; }} // Fallback to default image on error
          />
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <CardTitle className="text-lg mb-1 truncate">{name} #{tokenId}</CardTitle>
        {description && (
             <CardDescription className="text-sm mb-2 h-10 overflow-hidden text-ellipsis">
                 {description}
             </CardDescription>
        )}
        {showOwner && owner && (
            <p className="text-xs text-muted-foreground truncate">Owner: {owner}</p>
        )}
        {price && (
          <p className="font-semibold text-md mt-2">{price}</p>
        )}
      </CardContent>
      {(actionButtonLabel || onActionClick) && (
          <CardFooter className="p-4 pt-0">
            <Button 
                variant="default" 
                size="sm" 
                className="w-full" 
                onClick={onActionClick}
                disabled={!onActionClick} // Disable if no handler provided
            >
              {actionButtonLabel || 'Action'}
            </Button>
          </CardFooter>
      )}
    </Card>
  );
};

export default NFTCard; 