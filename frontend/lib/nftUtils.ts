// frontend/lib/nftUtils.ts
import { Buffer } from 'buffer'; // Make sure buffer is installed (pnpm install buffer)

export interface NftMetadata {
    name?: string;
    description?: string;
    image?: string;
    // Add other potential fields if needed
}

export async function fetchMetadata(tokenUri: string): Promise<{ metadata: NftMetadata | null, error?: string }> {
    if (!tokenUri) {
        return { metadata: null, error: "Token URI is empty" };
    }

    let url = tokenUri;

    // Handle IPFS URIs
    if (tokenUri.startsWith('ipfs://')) {
        // Use a public gateway or your preferred one
        url = `https://cloudflare-ipfs.com/ipfs/${tokenUri.substring(7)}`; 
    } 
    // Handle base64 encoded JSON URIs
    else if (tokenUri.startsWith('data:application/json;base64,')) {
        try {
            const base64String = tokenUri.substring('data:application/json;base64,'.length);
            const jsonString = Buffer.from(base64String, 'base64').toString('utf-8');
            const metadata: NftMetadata = JSON.parse(jsonString);
            // Basic validation
            if (!metadata.image) { 
                 console.warn("Metadata fetched from base64 URI is missing 'image'", metadata);
            }
            return { metadata };
        } catch (error: any) {
            console.error("Error parsing base64 metadata:", error);
            return { metadata: null, error: `Error parsing base64 metadata: ${error.message}` };
        }
    }
    // Handle standard HTTP(S) URLs
    else if (!tokenUri.startsWith('http://') && !tokenUri.startsWith('https://')) {
         console.warn(`Unsupported URI scheme or invalid URI: ${tokenUri}`);
        // Optionally try appending https:// if it looks like a relative path or CID?
         // For now, consider it an error or unhandled.
         return { metadata: null, error: `Unsupported URI scheme: ${tokenUri.substring(0, 10)}...` };
    }

    // Fetch from HTTP(S) or IPFS Gateway URL
    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const metadata: NftMetadata = await response.json();
         // Basic validation
        if (!metadata.image) { 
             console.warn("Metadata fetched from URL is missing 'image'", metadata);
        }
        return { metadata };
    } catch (error: any) {
        console.error(`Error fetching metadata from ${url}:`, error);
        return { metadata: null, error: `Failed to fetch metadata: ${error.message}` };
    }
}