module rwa_platform::marketplace {
    use iota::event;
    use iota::coin::{Self, Coin};
    use iota::iota::IOTA;
    use iota::table::{Self, Table};
    use iota::object::{Self, UID, ID};
    use iota::transfer;
    use iota::tx_context::{Self, TxContext};
    use std::vector::{Self};

    // Import the NFT struct from the other module
    use rwa_platform::carbon_nft_manager::{CarbonCreditNFT};

    // --- Structs ---

    /// Shared object holding the IDs of currently active listings.
    public struct ListingRegistry has key, store {
        id: UID,
        /// Maps active Listing object IDs to the seller's address.
        active_listings: Table<ID, address>,
        /// Stores the IDs of active listings for easy retrieval.
        active_listing_ids: vector<ID>,
    }

    /// Represents an NFT listed for sale on the marketplace.
    /// Holds the NFT object itself, transferring ownership to the Listing.
    public struct Listing has key, store {
        id: UID,
        /// The object ID of the NFT being sold (for event emission). Redundant if NFT is stored inside? No, good for events.
        nft_id: ID,
        /// The actual NFT object held by the listing.
        nft: CarbonCreditNFT,
        /// Price in microIOTA (1,000,000 microIOTA = 1 IOTA).
        price_micro_iota: u64,
        /// Original seller's address.
        seller: address,
    }

    // --- Events ---

    /// Emitted when an item is listed.
    public struct ListingCreated has copy, drop, store {
        listing_id: ID, // ID of the Listing object
        nft_id: ID,     // ID of the NFT object inside
        seller: address,
        price_micro_iota: u64,
    }

    /// Emitted when an item is purchased.
    public struct ItemSold has copy, drop, store {
        listing_id: ID,
        nft_id: ID,
        seller: address,
        buyer: address,
        price_micro_iota: u64,
    }

    /// Emitted when a listing is cancelled.
    public struct ListingCancelled has copy, drop, store {
        listing_id: ID,
        nft_id: ID,
        seller: address,
    }

    // --- Errors ---
    const EIncorrectPaymentAmount: u64 = 101;
    const ENotSeller: u64 = 102;
    // const ECoinNotIOTA: u64 = 103; // Optional, if restricting to IOTA

    // --- Functions ---

    /// List an NFT for sale. Consumes the NFT object passed by value.
    public entry fun list_item(
        registry: &mut ListingRegistry, // Registry to record the active listing
        nft: CarbonCreditNFT, // NFT object transferred to the function
        price_micro_iota: u64, // Asking price
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        let nft_original_id = object::id(&nft); // Get NFT ID before it's moved

        // Create the Listing object, taking ownership of the NFT
        let listing = Listing {
            id: object::new(ctx),
            nft_id: nft_original_id,
            nft: nft, // NFT is moved into the listing here
            price_micro_iota: price_micro_iota,
            seller: sender,
        };

        let listing_id = object::id(&listing);

        // Add to registry
        table::add(&mut registry.active_listings, listing_id, sender);
        // Add ID to the vector
        vector::push_back(&mut registry.active_listing_ids, listing_id);

        // Emit event
        event::emit(ListingCreated {
            listing_id: listing_id,
            nft_id: nft_original_id,
            seller: sender,
            price_micro_iota: price_micro_iota,
        });

        // Share the Listing object so buyers can find it
        transfer::public_share_object(listing);
    }

    /// Buy a listed item.
    public entry fun buy_item(
        registry: &mut ListingRegistry, // Registry to remove the listing from
        listing: Listing, // Pass the Listing object by value
        payment: Coin<IOTA>, // Payment coin (must be IOTA)
        ctx: &mut TxContext
    ) {
        let buyer = tx_context::sender(ctx);

        let listing_obj_id = object::id(&listing); // Get listing ID before consuming

        // Check payment amount
        assert!(coin::value(&payment) == listing.price_micro_iota, EIncorrectPaymentAmount);

        // Destructure the Listing object to take ownership of its fields
        let Listing {
            id: listing_uid, // UID of the listing object itself
            nft_id,          // Original ID of the NFT
            nft,             // The CarbonCreditNFT object
            price_micro_iota, // Price
            seller,          // Seller address
        } = listing; // 'listing' is consumed here

        // Remove from registry *before* potential transfer failures
        // Use the ID obtained before consumption
        let _removed_seller = table::remove(&mut registry.active_listings, listing_obj_id);

        // Transfer NFT to buyer
        transfer::public_transfer(nft, buyer);

        // Transfer payment to seller
        transfer::public_transfer(payment, seller);

        // Emit event
        event::emit(ItemSold {
            listing_id: listing_obj_id, // Use the ID obtained earlier
            nft_id: nft_id,
            seller: seller,
            buyer: buyer,
            price_micro_iota: price_micro_iota,
        });

        // No need to assert sender owns payment, transfer checks that

        // Explicitly delete the Listing object's UID
        object::delete(listing_uid);

        // Remove listing ID from the vector
        let (found, index) = vector::index_of(&registry.active_listing_ids, &listing_obj_id);
        if (found) {
            vector::swap_remove(&mut registry.active_listing_ids, index);
        }
    }

    /// Cancel a listing and get the NFT back.
    public entry fun cancel_listing(
        registry: &mut ListingRegistry, // Registry to remove the listing from
        listing: Listing, // Pass the Listing object by value
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);

        let listing_obj_id = object::id(&listing); // Get listing ID before consuming

        // Verify sender is the original seller before consuming the listing
        assert!(sender == listing.seller, ENotSeller);

        // Destructure the Listing object
        let Listing {
            id: listing_uid,
            nft_id,
            nft,
            seller,
            // price_micro_iota // Price not needed for cancel event/logic
            .. // Use '..' if you don't need all fields (like price)
        } = listing; // 'listing' is consumed here

        // Remove from registry
        // Use the ID obtained before consumption
        let _removed_seller = table::remove(&mut registry.active_listings, listing_obj_id);

        // Transfer NFT back to seller
        transfer::public_transfer(nft, seller);

        // Emit event
        event::emit(ListingCancelled {
            listing_id: listing_obj_id, // Use ID obtained earlier
            nft_id: nft_id,
            seller: seller, // which is sender
        });

         // Explicitly delete the Listing object's UID
        object::delete(listing_uid);

        // Remove listing ID from the vector
        let (found, index) = vector::index_of(&registry.active_listing_ids, &listing_obj_id);
        if (found) {
            vector::swap_remove(&mut registry.active_listing_ids, index);
        }
    }

    // --- Initialization Function --- //

    /// Called once during package deployment. Creates and shares the ListingRegistry.
    fun init(ctx: &mut TxContext) {
        let registry = ListingRegistry {
            id: object::new(ctx),
            active_listings: table::new<ID, address>(ctx),
            active_listing_ids: vector::empty<ID>() // Initialize empty vector
        };
        transfer::share_object(registry);
    }

    // --- View Function --- //

    /// Returns the object IDs of all currently active listings.
    /// TODO: Implement correct key retrieval for iota::table (standard iter/next functions do not exist).
    public fun get_active_listing_ids(registry: &ListingRegistry): vector<ID> {
        // Standard iteration pattern failed compilation.
        // Need to find the IOTA-specific way to iterate or query keys from iota::table::Table.
        // Return a copy of the vector storing active IDs.
        *&registry.active_listing_ids
    }
}
