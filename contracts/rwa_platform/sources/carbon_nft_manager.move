// Module: carbon_nft_manager
module rwa_platform::carbon_nft_manager {
    use iota::table::{Self, Table};
    use iota::display::{Self};
    use iota::package::{Self, Publisher};
    use std::string::{Self};
    use iota::object::{Self, UID, ID};
    use iota::transfer;
    use iota::tx_context::{Self, TxContext};
    use iota::event;
    use std::vector;

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

    /// Soulbound Token representing proof of retiring a CarbonCreditNFT.
    /// Has `key` but lacks `store` to make it non-transferable after minting.
    public struct RetirementCertificate has key, store {
        id: UID,
        /// ID of the original CarbonCreditNFT that was retired.
        original_nft_id: ID,
        /// Address of the account that retired the NFT.
        retirer_address: address,
        /// Amount from the retired NFT.
        retired_amount_kg_co2e: u64,
        /// Verification ID from the retired NFT.
        original_verification_id: vector<u8>,
        /// Timestamp (Unix milliseconds) when the retirement occurred.
        retirement_timestamp_ms: u64,
    }

    /// One-time witness for claiming the Publisher object.
    public struct CARBON_NFT_MANAGER has drop {}

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

    public struct CertificateMinted has copy, drop, store {
        certificate_id: ID,
        retirer_address: address,
        retired_amount_kg_co2e: u64,
        original_verification_id: vector<u8>,
        retirement_timestamp_ms: u64,
    }

    // --- Getter Functions for CarbonCreditNFT ---

    /// Returns the amount of CO2e in the NFT.
    public fun get_nft_amount(nft: &CarbonCreditNFT): u64 {
        nft.amount_kg_co2e
    }

    /// Returns the activity type code of the NFT.
    public fun get_nft_activity_type(nft: &CarbonCreditNFT): u8 {
        nft.activity_type
    }

    /// Returns the verification ID of the NFT.
    public fun get_nft_verification_id(nft: &CarbonCreditNFT): vector<u8> {
        nft.verification_id
    }

    /// Returned if the amount_kg_co2e provided for minting is zero.
    const EInvalidAmount: u64 = 1;
    /// Returned if trying to mint with a verification_id that has already been used.
    const EVerificationIdAlreadyProcessed: u64 = 2;

    /// by calling the `create_display` function with the Publisher object.
    fun init(witness: CARBON_NFT_MANAGER, ctx: &mut TxContext) {
        // 1. Claim the Publisher object using the one-time witness
        let publisher = package::claim(witness, ctx);
        transfer::public_transfer(publisher, tx_context::sender(ctx));

        // 2. Create and transfer AdminCap
        let admin_cap = AdminCap { id: object::new(ctx) };
        transfer::public_transfer(admin_cap, tx_context::sender(ctx));

        // 3. Create and share the Verification Registry (for minting)
        let verification_registry = VerificationRegistry {
            id: object::new(ctx),
            processed_ids: table::new<vector<u8>, bool>(ctx)
        };
        transfer::share_object(verification_registry);
    }

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
            // string::utf8(b"image_url"),
            // string::utf8(b"project_url")
        ];
        let values = vector[
            string::utf8(b"Verified Carbon Credit NFT"),
            string::utf8(b"A unique NFT representing verified carbon credits from sustainable transport activities."),
            // string::utf8(b"https://yourproject.xyz/nft_image/{id}.png"), // Simplified image template
            // string::utf8(b"https://yourproject.xyz") // Project website URL
        ];
        // Pass keys and values as separate arguments
        display::add_multiple(&mut display, keys, values);
        display::update_version(&mut display); // Increment version after changes

        // Share the display object publicly using public_share_object.
        transfer::public_share_object(display);
    }

    /// Mints a new CarbonCreditNFT. Requires AdminCap authorization.
    /// Checks against VerificationRegistry to prevent double minting.
    public entry fun mint_nft(
        _admin_cap: &AdminCap, // Authorization check is the capability requirement itself
        registry: &mut VerificationRegistry, // Shared registry to record processed IDs
        recipient: address,
        amount_kg_co2e: u64, // In grams or chosen unit
        activity_type: u8,
        verification_id: vector<u8>,
        ctx: &mut TxContext
    ) {
        // 1. Validate input
        assert!(amount_kg_co2e > 0, EInvalidAmount);

        // 2. Prevent Double Minting
        assert!(!table::contains(&registry.processed_ids, verification_id), EVerificationIdAlreadyProcessed);
        // Mark this verification ID as processed
        table::add(&mut registry.processed_ids, copy verification_id, true);

        // 3. Create the NFT Object
        let nft = CarbonCreditNFT {
            id: object::new(ctx),
            amount_kg_co2e: amount_kg_co2e,
            activity_type: activity_type,
            // Store a copy in the NFT, consume the original when adding to the table
            verification_id: copy verification_id,
            issuance_timestamp_ms: tx_context::epoch_timestamp_ms(ctx),
        };

        // 4. Emit Mint Event
        event::emit(MintNFTEvent {
            nft_id: object::id(&nft), // Get the immutable ID of the new NFT
            recipient: recipient,
            amount_kg_co2e: amount_kg_co2e,
            verification_id: verification_id, // Use the value consumed by table::add
        });

        // 5. Transfer NFT to Recipient
        transfer::public_transfer(nft, recipient);
    }

    /// Retires (burns) a specific CarbonCreditNFT and issues a non-transferable
    /// RetirementCertificate SBT to the retirer. Called by the NFT owner.
    public entry fun retire_nft(nft: CarbonCreditNFT, ctx: &mut TxContext) {
        // Object 'nft' is passed by value, consuming it.

        // 1. Extract necessary data before the object is inaccessible
        let CarbonCreditNFT {
            id, // The UID struct
            amount_kg_co2e,
            activity_type: _, // Activity type not needed for event/cert, ignored
            verification_id, // Keep this for the certificate
            issuance_timestamp_ms: _, // Timestamp not needed for event/cert, ignored
        } = nft; // 'nft' is consumed/destroyed here

        let nft_id_value = object::uid_to_inner(&id); // Get the ID value from the UID
        let retirer = tx_context::sender(ctx);

        // 2. Emit Retirement Event (using copied verification_id)
        // Make sure verification_id is consumed either here or in the certificate. Copy if needed for both.
        event::emit(RetireNFTEvent {
            retirer: retirer,
            nft_id: nft_id_value,
            amount_kg_co2e: amount_kg_co2e,
            verification_id: copy verification_id, // Copy ID for the event
        });

        // 3. Object Destruction happens automatically for fields moved out.
        //    Explicitly delete the remaining UID wrapper of the original NFT.
        object::delete(id);

        // ---- Mint the Retirement Certificate SBT ----
        let retirement_timestamp = tx_context::epoch_timestamp_ms(ctx);
        let certificate = RetirementCertificate {
            id: object::new(ctx), // Create a new UID for the certificate
            original_nft_id: nft_id_value,
            retirer_address: retirer,
            retired_amount_kg_co2e: amount_kg_co2e,
            original_verification_id: verification_id, // Consume the original verification_id here
            retirement_timestamp_ms: retirement_timestamp,
        };

        // Transfer the SBT to the retirer, making it non-transferable (soulbound)
        event::emit(CertificateMinted {
            certificate_id: object::id(&certificate),
            retirer_address: retirer,
            retired_amount_kg_co2e: amount_kg_co2e,
            original_verification_id: verification_id,
            retirement_timestamp_ms: retirement_timestamp 
        });

        transfer::transfer(certificate, retirer);
    }

    /// Function the *owner* of a certificate would call to freeze it.
    /// Takes ownership of the certificate object from the sender.
    public entry fun freeze_my_certificate(certificate: RetirementCertificate, _ctx: &mut TxContext) {
        // The transaction sender must own the 'certificate' object being passed in.
        transfer::freeze_object(certificate);
    }

    #[test_only]
    /// Checks if a verification ID exists in the registry. Only callable in tests.
    public fun is_verification_id_processed(registry: &VerificationRegistry, verification_id: vector<u8>): bool {
        table::contains(&registry.processed_ids, verification_id)
    }

    #[test_only]
    /// Creates an AdminCap for testing purposes.
    public fun test_create_admin_cap(ctx: &mut TxContext): AdminCap {
        AdminCap { id: object::new(ctx) }
    }

    #[test_only]
    /// Creates and shares a VerificationRegistry for testing purposes.
    /// Returns the ID of the shared registry.
    public fun test_create_and_share_registry(ctx: &mut TxContext): ID {
        let registry = VerificationRegistry {
            id: object::new(ctx),
            processed_ids: table::new<vector<u8>, bool>(ctx)
        };
        let id = object::id(&registry);
        // Use public_share_object as it has store ability
        transfer::public_share_object(registry);
        id
    }
}
