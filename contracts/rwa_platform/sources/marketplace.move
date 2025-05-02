module rwa_platform::marketplace {
    use iota::event;
    use iota::coin::{Self, Coin};
    use iota::iota::IOTA;

    // Import the NFT struct from the other module
    use rwa_platform::carbon_nft_manager::{CarbonCreditNFT};

    // --- Structs ---

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

        // Emit event
        event::emit(ListingCreated {
            listing_id: object::id(&listing),
            nft_id: nft_original_id,
            seller: sender,
            price_micro_iota: price_micro_iota,
        });

        // Share the Listing object so buyers can find it
        transfer::public_share_object(listing);
    }

    /// Buy a listed item.
    public entry fun buy_item(
        listing: Listing, // Pass the Listing object by value
        payment: Coin<IOTA>, // Payment coin (must be IOTA)
        ctx: &mut TxContext
    ) {
        let buyer = tx_context::sender(ctx);

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

        // Transfer NFT to buyer
        transfer::public_transfer(nft, buyer);

        // Transfer payment to seller
        transfer::public_transfer(payment, seller);

        // Emit event
        event::emit(ItemSold {
            listing_id: object::uid_to_inner(&listing_uid), // Get ID from UID
            nft_id: nft_id,
            seller: seller,
            buyer: buyer,
            price_micro_iota: price_micro_iota,
        });

        // Explicitly delete the Listing object's UID
        object::delete(listing_uid);
    }


    /// Cancel a listing and get the NFT back.
    public entry fun cancel_listing(
        listing: Listing, // Pass the Listing object by value
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);

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

        // Transfer NFT back to seller
        transfer::public_transfer(nft, seller);

        // Emit event
        event::emit(ListingCancelled {
            listing_id: object::uid_to_inner(&listing_uid), // Get ID from UID
            nft_id: nft_id,
            seller: seller, // which is sender
        });

         // Explicitly delete the Listing object's UID
        object::delete(listing_uid);
    }

}
