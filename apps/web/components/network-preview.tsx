export function NetworkPreview() {
  return (
    <svg
      className="network-preview"
      viewBox="0 0 720 560"
      role="img"
      aria-labelledby="network-preview-title network-preview-description"
    >
      <title id="network-preview-title">Shared three-dimensional ENA space</title>
      <desc id="network-preview-description">
        A schematic network with experimental and control centroid paths, plus
        red, blue, and green SVD axes.
      </desc>
      <defs>
        <linearGradient id="network-plane" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e7eef8" stopOpacity="0.8" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.25" />
        </linearGradient>
        <filter id="network-shadow" x="-40%" y="-40%" width="180%" height="180%">
          <feDropShadow dx="0" dy="8" stdDeviation="10" floodOpacity="0.14" />
        </filter>
      </defs>

      <path d="M88 414 444 518 645 326 282 233Z" fill="url(#network-plane)" />
      <g fill="none" stroke="#cbd5e1" strokeWidth="1">
        <path d="M88 414 444 518 645 326 282 233Z" />
        <path d="M137 378 492 478" />
        <path d="M186 343 540 438" />
        <path d="M235 306 590 396" />
        <path d="M162 435 357 251" />
        <path d="M244 458 439 271" />
        <path d="M332 486 525 292" />
      </g>

      <g fill="none" strokeLinecap="round" strokeWidth="4">
        <path d="M325 392 583 464" stroke="#b91c1c" />
        <path d="M325 392 165 474" stroke="#1d4ed8" />
        <path d="M325 392 327 102" stroke="#15803d" />
      </g>
      <g fontFamily="system-ui, sans-serif" fontSize="14" fontWeight="700">
        <text x="594" y="470" fill="#b91c1c">SVD1</text>
        <text x="107" y="493" fill="#1d4ed8">SVD2</text>
        <text x="341" y="105" fill="#15803d">SVD3</text>
      </g>

      <g fill="none" stroke="#94a3b8" strokeWidth="2.5" opacity="0.72">
        <path d="M228 317 352 243 478 310 419 399 298 405Z" />
        <path d="M228 317 419 399M352 243 298 405M478 310 298 405" />
      </g>
      <g filter="url(#network-shadow)">
        {[
          [228, 317, "EC"],
          [352, 243, "ICT"],
          [478, 310, "MCO"],
          [419, 399, "ATT"],
        ].map(([x, y, label]) => (
          <g key={label}>
            <circle cx={x} cy={y} r="25" fill="#ffffff" stroke="#1e3a5f" strokeWidth="3" />
            <text
              x={x}
              y={Number(y) + 5}
              textAnchor="middle"
              fill="#1e3a5f"
              fontSize="13"
              fontFamily="system-ui, sans-serif"
              fontWeight="700"
            >
              {label}
            </text>
          </g>
        ))}
      </g>

      <g fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="7">
        <path d="M218 438 275 372 351 347 432 283" stroke="#2563eb" />
        <path d="M251 283 318 312 402 351 491 391" stroke="#a16207" />
      </g>
      <g fill="#fff" strokeWidth="5">
        {[[218,438],[275,372],[351,347],[432,283]].map(([x,y], index) => (
          <circle key={`blue-${index}`} cx={x} cy={y} r="10" stroke="#2563eb" />
        ))}
        {[[251,283],[318,312],[402,351],[491,391]].map(([x,y], index) => (
          <circle key={`gold-${index}`} cx={x} cy={y} r="10" stroke="#a16207" />
        ))}
      </g>
    </svg>
  );
}
