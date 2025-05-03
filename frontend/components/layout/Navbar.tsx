import React from 'react';
import Link from 'next/link';
import ConnectWallet from './ConnectWallet'; // Assuming ConnectWallet is in the same directory

const Navbar = () => {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center">
        <div className="mr-4 hidden md:flex">
          <Link href="/" className="mr-6 flex items-center space-x-2">
            {/* Placeholder for Logo */} 
            <span className="hidden font-bold sm:inline-block">
              VCOMarketplace
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-sm lg:gap-6">
            <Link
              href="/marketplace"
              className="transition-colors hover:text-foreground/80 text-foreground/60"
            >
              Marketplace
            </Link>
            <Link
              href="/actions"
              className="transition-colors hover:text-foreground/80 text-foreground/60"
            >
              Attestations
            </Link>
            <Link
              href="/my-assets"
              className="transition-colors hover:text-foreground/80 text-foreground/60"
            >
              My Assets
            </Link>
          </nav>
        </div>
        {/* Add mobile menu button here if needed */}
        <div className="flex flex-1 items-center justify-end space-x-2">
          <ConnectWallet />
        </div>
        {/* <WalletStatus /> */}
      </div>
    </header>
  );
};

export default Navbar; 