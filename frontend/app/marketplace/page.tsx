import React from 'react';
import MarketplaceList from '@/components/marketplace/MarketplaceList';

const MarketplacePage = () => {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">Marketplace</h1>
      <p className="text-muted-foreground mb-4">
        Browse and purchase Verifiable Carbon Credits listed for sale.
      </p>
      <MarketplaceList />
    </div>
  );
};

export default MarketplacePage; 