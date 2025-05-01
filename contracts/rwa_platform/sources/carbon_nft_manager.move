// Module: carbon_nft_manager
// Responsible for defining, minting, and managing CarbonCreditNFTs.
module rwa_platform::carbon_nft_manager {
    use iota::object::{Self, UID, ID};
    use iota::transfer;
    use iota::tx_context::{Self, TxContext};
    use iota::event;
    use iota::table::{Self, Table};
    use iota::display::{Self, Display};
    use iota::package::{Self, Publisher};
    use iota::iota::IOTA;
    use std::string::{Self, String};
    use std::vector; // Ensure vector is imported

    // --- Struct Definitions ---

    /// Represents a unique, verified carbon credit tied to a specific event.
    public struct CarbonCreditNFT has key, store {
        id: UID,
        /// Amount of CO2 equivalent in grams (or chosen unit).
        amount_kg_co2e: u64,
        /// Code representing the activity type (e.g., 1=Cycling, 2=Walking).
        activity_type: u8,
        /// Unique ID from the verification oracle for the specific event.
        verification_id: vector<u8>,
        /// Timestamp (Unix milliseconds) when the NFT was minted.
        issuance_timestamp_ms: u64,
    }

    /// Capability object granting minting authority. Held by the backend.
    public struct AdminCap has key, store {
        id: UID
    }

    /// Shared object to prevent double-minting based on verification_id.
    public struct VerificationRegistry has key, store {
        id: UID,
        /// Table mapping verification_id (bytes) to true if processed.
        processed_ids: Table<vector<u8>, bool>
    }

    // --- Event Structs ---

    /// Emitted when a new CarbonCreditNFT is minted.
    public struct MintNFTEvent has copy, drop, store {
        nft_id: ID,
        recipient: address,
        amount_kg_co2e: u64,
        verification_id: vector<u8>,
    }

    /// Emitted when a CarbonCreditNFT is retired (burned).
    public struct RetireNFTEvent has copy, drop, store {
        retirer: address,
        nft_id: ID,
        amount_kg_co2e: u64,
        verification_id: vector<u8>,
    }

    // --- Error Codes ---

    /// Returned if the amount_kg_co2e provided for minting is zero.
    const EInvalidAmount: u64 = 1;
    /// Returned if trying to mint with a verification_id that has already been used.
    const EVerificationIdAlreadyProcessed: u64 = 2;

    // --- Initialization Function ---

    /// Called once during package deployment. Sets up AdminCap and Registry.
    /// NOTE: Display object must be created in a separate transaction post-deployment
    /// by calling the `create_display` function with the Publisher object.
    fun init(ctx: &mut TxContext) {
        // 1. Create and transfer AdminCap to the deployer (publisher).
        let admin_cap = AdminCap { id: object::new(ctx) };
        transfer::public_transfer(admin_cap, tx_context::sender(ctx));

        // 2. Create and share the Verification Registry.
        let registry = VerificationRegistry {
            id: object::new(ctx),
            processed_ids: table::new<vector<u8>, bool>(ctx)
        };
        transfer::share_object(registry);

        // 3. Display object creation REMOVED from init.
        // Must be called separately via `create_display` function.
        /*
        let display = display::new<CarbonCreditNFT>(tx_context::publisher(ctx), ctx); // Publisher needed here
        let keys = vector[
            string::utf8(b"name"),
            string::utf8(b"description"),
            string::utf8(b"link"),
            string::utf8(b"image_url"),
            string::utf8(b"project_url")
        ];
        let values = vector[
            string::utf8(b"Verified Carbon Credit NFT"),
            string::utf8(b"A unique NFT representing verified carbon credits from sustainable transport activities."),
            string::utf8(b"https://yourproject.xyz/nft/{id}"), // Simplified link template
            string::utf8(b"https://yourproject.xyz/nft_image/{id}.png"), // Simplified image template
            string::utf8(b"https://yourproject.xyz") // Project website URL
        ];
        display::add_multiple(&mut display, keys, values);
        display::update_version(&mut display);
        transfer::public_share_object(display);
        */
    }

    // --- Display Creation Function ---

    /// Creates and shares the Display object for CarbonCreditNFT.
    /// Must be called once by the package publisher after deployment.
    #[allow(lint(share_owned))] // Suppress warning as Display is newly created here
    public entry fun create_display(publisher: &Publisher, ctx: &mut TxContext) {
         // Create the Display object as mutable.
        let mut display = display::new<CarbonCreditNFT>(publisher, ctx);

        // Set collection-level metadata. Split keys and values.
        let keys = vector[
            string::utf8(b"name"),
            string::utf8(b"description"),
            string::utf8(b"link"),
            string::utf8(b"image_url"),
            string::utf8(b"project_url")
        ];
        let values = vector[
            string::utf8(b"Verified Carbon Credit NFT"),
            string::utf8(b"A unique NFT representing verified carbon credits from sustainable transport activities."),
            string::utf8(b"https://yourproject.xyz/nft/{id}"), // Simplified link template
            string::utf8(b"https://yourproject.xyz/nft_image/{id}.png"), // Simplified image template
            string::utf8(b"https://yourproject.xyz") // Project website URL
        ];
        // Pass keys and values as separate arguments
        display::add_multiple(&mut display, keys, values);
        display::update_version(&mut display); // Increment version after changes

        // Share the display object publicly using public_share_object.
        transfer::public_share_object(display);
    }

    // --- Placeholder for Phase 2 & 3 Functions ---
    // public entry fun mint_nft(...) { ... }
    // public entry fun retire_nft(...) { ... }

} 