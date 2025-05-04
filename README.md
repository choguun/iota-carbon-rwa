# IOTA Carbon RWA Platform

This project demonstrates a platform for tokenizing real-world assets (RWAs), specifically verified carbon credits earned through sustainable transportation, as NFTs on the IOTA EVM network. It includes Move smart contracts, a Node.js/Express backend for verification and minting, and a Next.js frontend for user interaction.

## Project Goal

To create a decentralized application where users can:
1.  Submit proof of sustainable transport activities (e.g., cycling, walking screenshots from fitness apps).
2.  Have the proof verified off-chain using AI (OpenAI Vision).
3.  Receive a unique `CarbonCreditNFT` on the IOTA network representing the verified carbon offset.
4.  View their owned NFTs.
5.  List their NFTs for sale on a simple marketplace.
6.  Browse and purchase listed NFTs using IOTA tokens.
7.  Retire (burn) their NFTs to claim the offset.
8.  Receive an on-chain `RetirementCertificate` as proof after retiring an NFT.

## Technology Stack

*   **Blockchain:** IOTA EVM
*   **Smart Contracts:** Move (on IOTA)
*   **Backend:** Node.js, Express, TypeScript, OpenAI API, `@iota/iota-sdk`
*   **Frontend:** Next.js, React, TypeScript, Tailwind CSS, Shadcn UI, `@iota/dapp-kit`, `@iota/iota-sdk`
*   **Package Manager:** pnpm

## Project Structure

```
.
├── backend/         # Node.js/Express backend server
│   ├── src/
│   ├── .env.example # Example environment variables
│   └── ...
├── contracts/       # Move smart contracts
│   └── rwa_platform/
│       ├── sources/ # Move source files (.move)
│       ├── tests/   # Move unit tests (partially implemented)
│       └── Move.toml
├── frontend/        # Next.js frontend application
│   ├── app/
│   ├── components/
│   ├── public/      # Static assets (images)
│   ├── .env.local   # Frontend environment variables (local)
│   └── ...
├── .gitignore
└── README.md
```

## Architecture Overview

```mermaid
flowchart LR
    subgraph User Interaction
        direction LR
        User --> FE(Next.js Frontend)
    end

    subgraph Verification & Minting
        direction TB
        BE(Node.js Backend) -- Image Data --> OpenAI(OpenAI Vision API)
        OpenAI -- Verification Result --> BE
        BE -- Mint TX --> IOTA(IOTA Network)
    end
    
    subgraph Blockchain
         direction TB
         IOTA -- NFT Object Data --> FE
         IOTA -- Marketplace Data --> FE
         IOTA -- Mint/List/Buy/Retire TXs --> Contracts(Move Contracts)
    end

    FE -- Attestation Request --> BE
    FE -- Sign Request --> Wallet[(User Wallet)]
    Wallet -- Signed TX --> FE
    FE -- Submit TX --> IOTA
    FE -- Read Data --> IOTA

    classDef service fill:#f9f,stroke:#333,stroke-width:2px;
    classDef blockchain fill:#ccf,stroke:#333,stroke-width:2px;
    classDef user fill:#cfc,stroke:#333,stroke-width:2px;
    class FE,User,Wallet user;
    class BE,OpenAI service;
    class IOTA,Contracts blockchain;
```

## Key Flows

### 1. NFT Minting Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Backend
    participant OpenAI
    participant IOTA Network
    participant Wallet

    User->>Frontend: Uploads Fitness Screenshot (e.g., /actions)
    Frontend->>Backend: POST /request-attestation (image data, userAddress)
    Backend->>OpenAI: Analyze Image Request
    OpenAI-->>Backend: Verification Result (activity, distance, etc.)
    alt Verification Successful
        Backend->>Backend: Calculate CO2e, Generate verification ID
        Backend->>IOTA Network: Construct `mint_nft` Transaction (using AdminCap)
        Backend->>IOTA Network: Sign & Submit Transaction
        IOTA Network-->>Backend: Transaction Digest/Confirmation
        Backend-->>Frontend: Success Response (txDigest, amount)
    else Verification Failed
        Backend-->>Frontend: Error Response
    end
    Frontend->>User: Show Success/Error Message
    User->>Frontend: Navigates to /my-assets
    Frontend->>Wallet: Request Connected Account
    Wallet-->>Frontend: Provide Account Address
    Frontend->>IOTA Network: Get Owned NFTs (filtered by type)
    IOTA Network-->>Frontend: NFT Object IDs
    Frontend->>IOTA Network: Get Object Details (for each NFT)
    IOTA Network-->>Frontend: NFT Data
    Frontend->>User: Displays Owned NFTs (including newly minted one)
```

### 2. Marketplace Flow (Listing & Buying)

```mermaid
sequenceDiagram
    participant Seller
    participant Buyer
    participant Frontend
    participant Wallet
    participant IOTA Network

    %% Listing an Item %%
    Seller->>Frontend: Navigates to /my-assets
    Seller->>Frontend: Clicks "List for Sale" on an NFT
    Frontend->>Seller: Opens Listing Dialog (Input Price)
    Seller->>Frontend: Confirms Price
    Frontend->>Wallet: Request Transaction Signature (`list_item` call)
    Wallet-->>Frontend: Provides Signed Transaction
    Frontend->>IOTA Network: Submits `list_item` Transaction
    IOTA Network-->>Frontend: Transaction Confirmation/Digest
    Frontend->>Seller: Shows Success Message

    %% Browsing and Buying %%
    Buyer->>Frontend: Navigates to /marketplace
    Frontend->>IOTA Network: Call `get_active_listing_ids` (View Call)
    IOTA Network-->>Frontend: List of Active Listing IDs
    Frontend->>IOTA Network: Fetch Object Details for each Listing ID
    IOTA Network-->>Frontend: Listing Objects (incl. nested NFT data)
    Frontend->>Buyer: Displays Available Listings
    Buyer->>Frontend: Clicks "Buy Now" on a Listing
    Frontend->>Buyer: Shows Confirmation
    Buyer->>Frontend: Confirms Purchase
    Frontend->>Wallet: Request Transaction Signature (`buy_item` call, incl. payment coin)
    Wallet-->>Frontend: Provides Signed Transaction
    Frontend->>IOTA Network: Submits `buy_item` Transaction
    IOTA Network-->>Frontend: Transaction Confirmation/Digest
    Frontend->>Buyer: Shows Success Message
    Buyer->>Frontend: Navigates to /my-assets (sees purchased NFT)

    %% Canceling a Listing %%
    Seller->>Frontend: Navigates to /marketplace
    Seller->>Frontend: Clicks "Cancel Listing" on own listing
    Frontend->>Wallet: Request Transaction Signature (`cancel_listing` call)
    Wallet-->>Frontend: Provides Signed Transaction
    Frontend->>IOTA Network: Submits `cancel_listing` Transaction
    IOTA Network-->>Frontend: Transaction Confirmation/Digest
    Frontend->>Seller: Shows Success Message
```

### 3. NFT Retirement Flow

```mermaid
sequenceDiagram
    participant User
    participant Frontend
    participant Wallet
    participant IOTA Network

    User->>Frontend: Navigates to /my-assets
    User->>Frontend: Clicks "Retire" on an owned CarbonCreditNFT
    Frontend->>Wallet: Request Transaction Signature (`retire_nft` call with NFT ID)
    Wallet-->>Frontend: Provides Signed Transaction
    Frontend->>IOTA Network: Submits `retire_nft` Transaction
    IOTA Network-->>Frontend: Transaction Confirmation/Digest
    Note over IOTA Network: `retire_nft` consumes NFT, creates & transfers `RetirementCertificate`
    Frontend->>User: Shows Success Message
    User->>Frontend: Refreshes /my-assets page (or auto-refreshes)
    Frontend->>IOTA Network: Get Owned Objects (NFTs and Certificates)
    IOTA Network-->>Frontend: Object IDs and Data
    Frontend->>User: Displays updated list (NFT removed, Certificate added)

```

## Setup Instructions

1.  **Prerequisites:**
    *   Node.js (v18 or later recommended)
    *   pnpm (`npm install -g pnpm`)
    *   IOTA CLI (`iota-client`) installed and configured (for contract deployment and manual interactions). See [IOTA Wiki](https://wiki.iota.org/iota-evm/tools/cli/)
    *   An IOTA wallet (e.g., TanglePay, Metamask configured for IOTA EVM) with testnet IOTA tokens. **Crucially, ensure you have at least TWO separate coin objects in your wallet to pay for gas.** You might need to manually split your main coin object using the CLI or receive a small second transfer if you only have one.
    *   OpenAI API Key.

2.  **Clone the Repository:**
    ```bash
    git clone <repository_url>
    cd iota-carbon-rwa # Or your repository name
    ```

3.  **Backend Setup:**
    ```bash
    cd backend
    pnpm install
    cp .env.example .env
    ```
    *   Edit `.env` and fill in the required values:
        *   `OPENAI_API_KEY`: Your OpenAI API key.
        *   `IOTA_NODE_URL`: URL of the IOTA EVM JSON-RPC endpoint.
        *   `IOTA_PACKAGE_ID`: Deployed Move package ID (initially blank).
        *   `IOTA_ADMIN_CAP_ID`: Deployed `AdminCap` object ID (initially blank).
        *   `IOTA_VERIFICATION_REGISTRY_ID`: Deployed `VerificationRegistry` object ID (initially blank).
        *   `IOTA_DEPLOYER_PRIVATE_KEY`: **Private key** of the account that will hold the `AdminCap` and mint NFTs. Keep this secure!
        *   `PROVIDER_PORT`: Port for the backend server (default 3001).

4.  **Frontend Setup:**
    ```bash
    cd ../frontend
    pnpm install
    # Create .env.local from example if it doesn't exist, or just create it.
    touch .env.local
    ```
    *   Edit `.env.local` and fill in the required values:
        *   `NEXT_PUBLIC_IOTA_NODE_URL`: URL of the IOTA EVM JSON-RPC endpoint (can be the same as backend).
        *   `NEXT_PUBLIC_PACKAGE_ID`: Deployed Move package ID (initially blank).
        *   `NEXT_PUBLIC_MARKETPLACE_PACKAGE_ID`: Deployed Move package ID (usually same as above).
        *   `NEXT_PUBLIC_DISPLAY_OBJECT_ID`: Deployed NFT `Display` object ID (initially blank).
        *   `NEXT_PUBLIC_LISTING_REGISTRY_ID`: Deployed `ListingRegistry` object ID (initially blank).
        *   `NEXT_PUBLIC_BACKEND_URL`: URL of your running backend server (e.g., `http://localhost:3001`).

## Deployment Instructions

1.  **Deploy Move Contracts:**
    *   Navigate to the contracts directory: `cd ../contracts/rwa_platform`
    *   Compile the contracts:
        ```bash
        # Assuming iota-client is configured
        iota-client move compile --fetch-deps-only
        iota-client move compile
        ```
    *   Deploy the package (this requires your configured CLI wallet to have gas funds):
        ```bash
        # This command will output the deployed package ID and created objects
        iota-client move publish --gas-budget 500000000 # Adjust gas budget
        ```
    *   **Record the Output:** Note down the `Package ID`, the `AdminCap` object ID, the `VerificationRegistry` object ID, and the `ListingRegistry` object ID printed after successful deployment.
    *   **Update Backend `.env`:** Fill in `IOTA_PACKAGE_ID`, `IOTA_ADMIN_CAP_ID`, `IOTA_VERIFICATION_REGISTRY_ID` with the recorded values.
    *   **Update Frontend `.env.local`:** Fill in `NEXT_PUBLIC_PACKAGE_ID`, `NEXT_PUBLIC_MARKETPLACE_PACKAGE_ID`, `NEXT_PUBLIC_LISTING_REGISTRY_ID` with the recorded values.

2.  **Create NFT Display Object:**
    *   The `Display` object makes NFT collections discoverable by wallets/explorers. It must be created in a separate transaction *after* deployment using the `Publisher` object created during `init`.
    *   First, find the `Publisher` object ID owned by the deployer account (you can use an explorer or potentially the CLI if it shows objects created in the publish transaction).
    *   Execute the `create_display` function using the CLI:
        ```bash
        iota-client call \
            --package <IOTA_PACKAGE_ID> \
            --module carbon_nft_manager \
            --function create_display \
            --args <PUBLISHER_OBJECT_ID> \ # ID of the Publisher object
            --gas-budget 20000000 # Adjust gas budget
        ```
    *   **Record the Output:** Note down the `Display<...CarbonCreditNFT>` object ID created by this call.
    *   **Update Frontend `.env.local`:** Fill in `NEXT_PUBLIC_DISPLAY_OBJECT_ID` with the recorded value.

3.  **Run Backend Server:**
    ```bash
    cd ../../backend # Navigate back to backend directory
    pnpm dev # Or pnpm start for production build
    ```
    *   The server should start on the port specified in `.env` (default 3001).

4.  **Run Frontend Application:**
    ```bash
    cd ../frontend # Navigate back to frontend directory
    pnpm dev
    ```
    *   The frontend should be accessible at `http://localhost:3000` (or another port if 3000 is busy).

## Testing Instructions

1.  **Backend:**
    *   Currently, no automated tests are implemented.
    *   **Manual Testing:** Use tools like `curl` or Postman to send requests to the `/request-attestation` endpoint with valid/invalid data (including a base64 encoded image string) and observe the console output and blockchain interactions.

2.  **Frontend:**
    *   **Manual Testing:**
        *   Connect an IOTA wallet (ensure it has >1 coin object).
        *   Navigate through the pages: "Actions", "My Assets", "Marketplace".
        *   **Actions:** Upload a fitness screenshot, submit the request, and verify if an NFT appears in "My Assets" after a short delay. Check backend logs for OpenAI/minting status.
        *   **My Assets:** Verify owned NFTs are displayed correctly (image based on type, data). Test the "Retire" functionality - **verify the NFT disappears and a corresponding `RetirementCertificate` appears in the new section below**. Test the "List for Sale" button opens the dialog.
        *   **Listing Dialog:** Enter a price and submit. Check the marketplace page afterwards.
        *   **Marketplace:** Verify listed items appear. Test the "Buy Now" button (using a different account than the seller). Test the "Cancel Listing" button for items you listed. Check your wallet balance changes and NFT ownership transfers.
    *   **Wallet Interaction:** Test connecting/disconnecting the wallet. Test transaction signing prompts.
    *   **Gas Requirement:** Test the "Buy Now" flow with a wallet containing only one coin object - verify the correct error message appears instructing the user to split the coin.

3.  **Move Contracts:**
    *   **Unit Tests:** Partial unit tests exist in `contracts/rwa_platform/tests/`. Running them requires understanding the `iota::test_scenario` framework, which differs significantly from standard Sui testing. These tests were paused due to framework complexities. To attempt running them:
        ```bash
        cd ../contracts/rwa_platform
        iota-client move test
        ```
        Expect potential failures or the need for significant refactoring based on the IOTA test framework.
    *   **Manual CLI Interaction:** Use `iota-client call` to interact directly with deployed contract functions (`list_item`, `buy_item`, `cancel_listing`, `retire_nft`, `mint_nft` - requires AdminCap/Registry IDs) to test specific scenarios or edge cases. Verify that calling `retire_nft` results in the creation of a `RetirementCertificate` object owned by the caller.

## Important Notes

*   **Gas Coins:** The IOTA network **requires a separate coin object for gas payment**. You cannot use a single coin object to both pay gas and be the input for an operation (like splitting or transferring the full balance) in the same transaction. Users *must* have at least two coin objects in their wallet to perform most actions (buying, listing, retiring).
*   **Security:** The `IOTA_DEPLOYER_PRIVATE_KEY` in the backend `.env` grants minting capabilities. **Protect this key rigorously.** In a production scenario, consider using a more robust key management solution (e.g., HSM, KMS).
*   **Error Handling:** Frontend and backend error handling can be further improved for edge cases and user feedback.
*   **OpenAI Costs:** Using the OpenAI Vision API incurs costs. Monitor your usage.
*   **Image Placeholders:** Replace the placeholder image paths in the frontend constants (`CYCLING_IMAGE_URL`, etc.) with actual URLs or ensure corresponding files exist in `frontend/public/images/`.
