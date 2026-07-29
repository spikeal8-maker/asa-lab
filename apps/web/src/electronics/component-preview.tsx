export type PreviewKey = string;

interface Props {
  preview: PreviewKey;
  asset?: string | null;
  className?: string;
}

/**
 * Catalogue thumbnail. Sanitised owner/ASA SVG artwork always wins. Compact
 * inline drawings are original ASA planning previews for disabled future parts;
 * they are never used as evidence that the electrical model is complete.
 */
export function ComponentPreview({ preview, asset, className = '' }: Props): JSX.Element {
  if (asset) {
    return (
      <img
        className={`workbench-component-preview ${className}`}
        src={asset}
        alt=""
        draggable={false}
        loading="lazy"
      />
    );
  }

  const common = {
    className: `workbench-component-preview ${className}`,
    viewBox: '0 0 100 80',
    'aria-hidden': true,
  } as const;
  const lead = '#596b78';
  const board = '#087fa4';
  const dark = '#172431';
  const gold = '#d4a72c';

  switch (preview) {
    case 'button':
      return (
        <svg {...common}>
          <path d="M15 62h70" stroke={lead} strokeWidth="4" />
          <rect x="28" y="35" width="44" height="28" rx="5" fill="#29323a" />
          <rect x="38" y="20" width="24" height="22" rx="4" fill="#d94b42" stroke="#8e2d27" />
          <path d="M34 63v10M66 63v10" stroke={lead} strokeWidth="4" />
        </svg>
      );
    case 'potentiometer':
      return (
        <svg {...common}>
          <circle cx="50" cy="36" r="24" fill="#2f7da0" stroke="#185272" strokeWidth="3" />
          <circle cx="50" cy="36" r="8" fill="#dce9ee" />
          <path d="M50 36l13-10" stroke="#53646f" strokeWidth="4" strokeLinecap="round" />
          <path d="M32 59v14M50 60v13M68 59v14" stroke={lead} strokeWidth="4" />
        </svg>
      );
    case 'capacitor':
      return (
        <svg {...common}>
          <path d="M19 40h24M57 40h24" stroke={lead} strokeWidth="4" />
          <path d="M44 22v36M56 22v36" stroke="#465a68" strokeWidth="5" />
        </svg>
      );
    case 'inductor':
      return (
        <svg {...common}>
          <path d="M10 43h14c0-20 20-20 20 0 0-20 20-20 20 0 0-20 20-20 20 0h6" fill="none" stroke="#9b5b2c" strokeWidth="5" strokeLinecap="round" />
        </svg>
      );
    case 'slide-switch':
    case 'dip-switch':
      return (
        <svg {...common}>
          <rect x="18" y="25" width="64" height="36" rx="5" fill="#26343e" />
          <rect x="31" y="15" width="25" height="32" rx="4" fill="#e9eef1" stroke="#7b8a94" />
          <path d="M28 61v13M50 61v13M72 61v13" stroke={lead} strokeWidth="4" />
        </svg>
      );
    case 'coin-cell':
      return (
        <svg {...common}>
          <circle cx="50" cy="40" r="27" fill="#9a9a9a" stroke="#5d5d5d" strokeWidth="3" />
          <circle cx="50" cy="40" r="21" fill="#c5c9cb" />
          <text x="50" y="39" textAnchor="middle" fill="#555" fontSize="9">CR2032</text>
          <text x="50" y="51" textAnchor="middle" fill="#555" fontSize="11">3V</text>
        </svg>
      );
    case 'battery-aa':
      return (
        <svg {...common}>
          <rect x="35" y="9" width="30" height="62" rx="13" fill="#d65a47" stroke="#9b3427" strokeWidth="3" />
          <rect x="43" y="5" width="14" height="7" rx="2" fill="#c8cdd0" />
          <text x="50" y="44" textAnchor="middle" fill="#fff" fontWeight="700" fontSize="13">AA</text>
        </svg>
      );
    case 'battery-9v':
      return (
        <svg {...common}>
          <rect x="28" y="14" width="44" height="56" rx="6" fill="#3b4350" stroke="#1f2933" strokeWidth="3" />
          <circle cx="42" cy="13" r="6" fill="#c5c9cb" />
          <circle cx="59" cy="13" r="4" fill="#c5c9cb" />
          <text x="50" y="48" textAnchor="middle" fill="#fff" fontWeight="700" fontSize="14">9V</text>
        </svg>
      );
    case 'breadboard':
      return (
        <svg {...common}>
          <rect x="8" y="12" width="84" height="56" rx="5" fill="#fafafa" stroke="#aebbc4" strokeWidth="2" />
          {[20, 31, 49, 60].map((y) =>
            Array.from({ length: 13 }, (_, index) => (
              <circle key={`${y}-${index}`} cx={17 + index * 5.5} cy={y} r="1.4" fill="#596b78" />
            )),
          )}
          <path d="M13 8h74" stroke="#d83b36" strokeWidth="2" />
          <path d="M13 72h74" stroke="#2c62c9" strokeWidth="2" />
        </svg>
      );
    case 'microbit':
      return (
        <svg {...common}>
          <path d="M13 18h74v44H13z" fill="#111827" stroke="#05080d" strokeWidth="2" />
          {Array.from({ length: 5 }, (_, row) =>
            Array.from({ length: 5 }, (_, column) => (
              <circle key={`${row}-${column}`} cx={35 + column * 8} cy={29 + row * 7} r="1.5" fill="#ef4444" />
            )),
          )}
          <circle cx="23" cy="39" r="4" fill="#d8dde1" />
          <circle cx="77" cy="39" r="4" fill="#d8dde1" />
          <path d="M25 62v12M38 62v12M50 62v12M62 62v12M75 62v12" stroke={gold} strokeWidth="5" />
        </svg>
      );
    case 'arduino':
      return (
        <svg {...common}>
          <path d="M14 15h66l7 8v42H14z" fill="#138da5" stroke="#087086" strokeWidth="2" />
          <rect x="20" y="20" width="10" height="34" fill="#1d2730" />
          <rect x="66" y="20" width="10" height="34" fill="#1d2730" />
          <rect x="36" y="28" width="23" height="18" rx="2" fill="#202a32" />
          <rect x="8" y="27" width="12" height="18" fill="#aeb8bf" />
          {Array.from({ length: 7 }, (_, i) => <circle key={`l${i}`} cx="25" cy={23 + i * 5} r="1" fill={gold} />)}
          {Array.from({ length: 7 }, (_, i) => <circle key={`r${i}`} cx="71" cy={23 + i * 5} r="1" fill={gold} />)}
        </svg>
      );
    case 'servo':
      return (
        <svg {...common}>
          <rect x="25" y="27" width="50" height="35" rx="5" fill="#285e9a" stroke="#163d6d" strokeWidth="3" />
          <circle cx="50" cy="24" r="12" fill="#dde4e8" stroke="#8796a0" />
          <path d="M50 24h29" stroke="#c8d0d5" strokeWidth="6" strokeLinecap="round" />
          <path d="M38 62v12M50 62v12M62 62v12" stroke={lead} strokeWidth="3" />
        </svg>
      );
    case 'motor':
      return (
        <svg {...common}>
          <circle cx="49" cy="39" r="25" fill="#c7cdd1" stroke="#768691" strokeWidth="3" />
          <circle cx="49" cy="39" r="7" fill="#8b979f" />
          <path d="M74 39h17" stroke="#7a858c" strokeWidth="6" />
          <path d="M31 61v12M66 61v12" stroke={lead} strokeWidth="4" />
        </svg>
      );
    case 'relay':
      return (
        <svg {...common}>
          <rect x="22" y="20" width="56" height="45" rx="4" fill="#235c91" stroke="#173f65" strokeWidth="3" />
          <text x="50" y="47" textAnchor="middle" fill="#fff" fontSize="10">RELAY</text>
          {[28, 42, 58, 72].map((x) => <path key={x} d={`M${x} 65v10`} stroke={lead} strokeWidth="3" />)}
        </svg>
      );
    case 'transistor':
      return (
        <svg {...common}>
          <path d="M34 24h32l7 34H27z" fill="#28343d" stroke="#111820" strokeWidth="3" />
          <path d="M35 58v16M50 58v16M65 58v16" stroke={lead} strokeWidth="3" />
        </svg>
      );
    case 'diode':
      return (
        <svg {...common}>
          <path d="M10 40h28M62 40h28" stroke={lead} strokeWidth="4" />
          <rect x="37" y="32" width="26" height="16" rx="4" fill="#303b44" />
          <path d="M57 32v16" stroke="#d8dfe3" strokeWidth="4" />
        </svg>
      );
    case 'rgb-led':
      return (
        <svg {...common}>
          <path d="M31 46a19 19 0 0 1 38 0v12H31z" fill="url(#rgb)" stroke="#7c8891" strokeWidth="2" />
          <defs><linearGradient id="rgb"><stop stopColor="#ef4444" /><stop offset=".5" stopColor="#22c55e" /><stop offset="1" stopColor="#3b82f6" /></linearGradient></defs>
          {[35,45,55,65].map((x) => <path key={x} d={`M${x} 58v16`} stroke={lead} strokeWidth="3" />)}
        </svg>
      );
    case 'photoresistor':
    case 'sensor':
    case 'ultrasonic-sensor':
      return (
        <svg {...common}>
          <rect x="22" y="20" width="56" height="42" rx="7" fill="#2f8b75" stroke="#1d6253" strokeWidth="3" />
          <circle cx="40" cy="41" r="11" fill="#dce6e4" stroke="#536a65" />
          <circle cx="62" cy="41" r="8" fill="#dce6e4" stroke="#536a65" />
          <path d="M35 62v13M50 62v13M65 62v13" stroke={lead} strokeWidth="3" />
        </svg>
      );
    case 'seven-segment':
    case 'lcd':
    case 'led-matrix':
      return (
        <svg {...common}>
          <rect x="18" y="16" width="64" height="48" rx="4" fill="#25313b" stroke="#111820" strokeWidth="3" />
          <rect x="27" y="25" width="46" height="30" fill="#9bd28f" />
          <text x="50" y="45" textAnchor="middle" fill="#28452b" fontFamily="monospace" fontSize="13">88:88</text>
          {[25,35,45,55,65,75].map((x) => <path key={x} d={`M${x} 64v10`} stroke={lead} strokeWidth="2.5" />)}
        </svg>
      );
    case 'ic':
      return (
        <svg {...common}>
          <rect x="25" y="22" width="50" height="36" rx="3" fill={dark} />
          <circle cx="33" cy="29" r="3" fill="#8b99a3" />
          {[30,40,50,60,70].map((x) => <g key={x}><path d={`M${x} 22v-10`} stroke={lead} strokeWidth="3" /><path d={`M${x} 58v10`} stroke={lead} strokeWidth="3" /></g>)}
        </svg>
      );
    case 'multimeter':
      return (
        <svg {...common}>
          <rect x="27" y="8" width="46" height="64" rx="7" fill="#e8b21b" stroke="#8f6810" strokeWidth="3" />
          <rect x="35" y="16" width="30" height="15" rx="2" fill="#b7d2bf" />
          <text x="50" y="27" textAnchor="middle" fill="#27372b" fontFamily="monospace" fontSize="9">0.000</text>
          <circle cx="50" cy="48" r="11" fill="#26313a" />
          <circle cx="42" cy="65" r="3" fill="#1e2930" /><circle cx="58" cy="65" r="3" fill="#d33c36" />
        </svg>
      );
    case 'oscilloscope':
      return (
        <svg {...common}>
          <rect x="10" y="13" width="80" height="55" rx="5" fill="#35434d" stroke="#17232b" strokeWidth="3" />
          <rect x="18" y="21" width="47" height="38" fill="#0a1d22" />
          <path d="M20 40h8l5-13 7 26 7-26 7 26 6-13h4" fill="none" stroke="#57e58b" strokeWidth="2" />
          <circle cx="77" cy="27" r="4" fill="#d7dde1" /><circle cx="77" cy="40" r="4" fill="#d7dde1" /><circle cx="77" cy="53" r="4" fill="#d7dde1" />
        </svg>
      );
    case 'power-supply':
    case 'signal-generator':
      return (
        <svg {...common}>
          <rect x="12" y="18" width="76" height="48" rx="5" fill="#e7ecef" stroke="#71828d" strokeWidth="3" />
          <rect x="20" y="27" width="32" height="17" fill="#172431" />
          <text x="36" y="39" textAnchor="middle" fill="#68ef8f" fontFamily="monospace" fontSize="9">5.00 V</text>
          <circle cx="68" cy="35" r="8" fill="#697984" />
          <circle cx="63" cy="57" r="4" fill="#1d252b" /><circle cx="77" cy="57" r="4" fill="#d33c36" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <rect x="15" y="15" width="70" height="50" rx="8" fill="#eef1f5" stroke="#9aa4af" />
          <path d="M32 40h36" stroke="#66717d" strokeWidth="5" strokeLinecap="round" />
          <circle cx="25" cy="40" r="3" fill={board} /><circle cx="75" cy="40" r="3" fill={board} />
        </svg>
      );
  }
}
