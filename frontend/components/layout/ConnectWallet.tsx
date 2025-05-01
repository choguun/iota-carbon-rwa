'use client';

import { ConnectButton } from "@iota/dapp-kit";
import { Button } from "@/components/ui/button";
import React from 'react';

function ConnectWallet() {
  return (
    <Button asChild variant="outline" size="sm">
      <ConnectButton />
    </Button>
  );
}

export default ConnectWallet; 