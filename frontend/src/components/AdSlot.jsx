import { useEffect, useMemo } from 'react';

/**
 * Placeholder by default.
 * If you configure AdSense, set:
 * - VITE_ADSENSE_CLIENT="ca-pub-XXXX"
 * - VITE_ADSENSE_SLOT_CHAT="1234567890" (optional)
 * - VITE_ADSENSE_SLOT_VIDEO="1234567890" (optional)
 */
export default function AdSlot({
  placement = 'generic', // "chat" | "video" | "home" | ...
  minHeight = 90,
  style
}) {
  const client = import.meta.env.VITE_ADSENSE_CLIENT;
  const slotByPlacement = useMemo(
    () => ({
      chat: import.meta.env.VITE_ADSENSE_SLOT_CHAT,
      video: import.meta.env.VITE_ADSENSE_SLOT_VIDEO,
      home: import.meta.env.VITE_ADSENSE_SLOT_HOME
    }),
    []
  );
  const slot = slotByPlacement[placement];
  const adsEnabled = Boolean(client && slot && typeof window !== 'undefined');

  useEffect(() => {
    if (!adsEnabled) return;
    try {
      window.adsbygoogle = window.adsbygoogle || [];
      window.adsbygoogle.push({});
    } catch {
      // ignore
    }
  }, [adsEnabled, placement, slot]);

  const boxStyle = {
    minHeight,
    width: '100%',
    border: '1px dashed #ddd',
    borderRadius: 12,
    background: '#fafafa',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#999',
    fontSize: 12,
    textAlign: 'center',
    padding: 12,
    ...style
  };

  if (!adsEnabled) {
    return <div style={boxStyle}>Espace pub ({placement})</div>;
  }

  // Note: You still need to add the AdSense script in index.html for real ads.
  return (
    <div style={{ width: '100%' }}>
      <ins
        className="adsbygoogle"
        style={{ display: 'block', width: '100%', minHeight }}
        data-ad-client={client}
        data-ad-slot={slot}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </div>
  );
}

