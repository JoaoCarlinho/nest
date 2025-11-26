import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Nest - Site Layout Planner',
  description: 'Geospatial site layout optimization for energy infrastructure',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
