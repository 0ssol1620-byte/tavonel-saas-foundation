"use client";

type StageId = "sources" | "read" | "structure" | "world";

const sourceFiles = [
  ["Services Agreement.pdf", "PDF · 18 pages", "READY"],
  ["Operations Manual.docx", "DOCX · rev 9", "READY"],
  ["scan_0140.pdf", "SCAN · OCR", "READING"],
  ["Q3 forecast.xlsx", "XLSX · Finance", "READY"],
  ["Customer Research.zip", "ARCHIVE · 14 files", "QUEUED"],
] as const;

const readRows = [
  ["Heading", "3.2 Payment terms", "p.7 · bbox 08"],
  ["Claim", "Invoices are due 45 days after receipt.", "p.7 · bbox 14"],
  ["Table", "Certified amount · £32,613.00", "p.7 · bbox 22"],
  ["Relation", "PaymentTerms → constrains → Invoice", "evidence linked"],
] as const;

const entities = ["PaymentTerms", "Invoice", "PurchaseOrder", "ChangeOrder", "WarehouseB", "Finance", "Legal"] as const;

const worldNodes = [
  [18, 30, "PaymentTerms"],
  [42, 18, "Invoice"],
  [64, 30, "PurchaseOrder"],
  [82, 18, "ChangeOrder"],
  [28, 66, "WarehouseB"],
  [54, 62, "Finance"],
  [77, 70, "Legal"],
] as const;

const worldEdges = [
  [18, 30, 42, 18],
  [18, 30, 64, 30],
  [64, 30, 82, 18],
  [28, 66, 54, 62],
  [54, 62, 77, 70],
  [42, 18, 77, 70],
] as const;

function Chrome({ stage }: { stage: StageId }) {
  return (
    <div className="vf-chrome">
      <div className="vf-chrome-left"><i />TAVONEL · LIVE COMPILE</div>
      <div className="vf-chrome-right">{stage.toUpperCase()} · SOURCE-GROUNDED</div>
    </div>
  );
}

function Sources() {
  return (
    <div className="vf-stage vf-sources">
      <div className="vf-source-column">
        <div className="vf-kicker">SOURCE INTAKE</div>
        <h3>Knowledge arrives as it is.</h3>
        <div className="vf-file-list">
          {sourceFiles.map(([name, meta, state], index) => (
            <div className="vf-file" key={name} style={{ "--i": index } as React.CSSProperties}>
              <span className="vf-file-icon">{name.split(".").pop()?.slice(0, 3).toUpperCase()}</span>
              <span className="vf-file-copy"><strong>{name}</strong><small>{meta}</small></span>
              <span className={`vf-state vf-${state.toLowerCase()}`}>{state}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="vf-ingest-rail" aria-hidden="true"><span /><span /><span /></div>
      <div className="vf-receipt-column">
        <div className="vf-kicker">QUALIFIED INTAKE</div>
        <div className="vf-receipt">
          <div><span>01</span><strong>Quarantine</strong><small>source bytes isolated</small></div>
          <div><span>02</span><strong>Sanitize</strong><small>immutable readable copy</small></div>
          <div><span>03</span><strong>Read</strong><small>pages · regions · tables</small></div>
          <div><span>04</span><strong>Compile</strong><small>objects · relations · evidence</small></div>
        </div>
        <div className="vf-proofline"><i /> Every transition carries a receipt.</div>
      </div>
    </div>
  );
}

function Read() {
  return (
    <div className="vf-stage vf-read">
      <div className="vf-document-wrap">
        <div className="vf-kicker">SOURCE · PAGE 7</div>
        <div className="vf-paper">
          <div className="vf-paper-meta">ACME HOLDINGS · SERVICES AGREEMENT · VERSION 17</div>
          <h3>3.2 Payment terms</h3>
          <p>Invoices are due <mark>45 days after receipt</mark> of a valid invoice.</p>
          <p>Late amounts accrue 1.5% per month. Disputes require written notice.</p>
          <div className="vf-table">
            <span>Description</span><span>Basis</span><span>Amount</span>
            <b>Warehouse B survey</b><b>two days</b><b>£4,200.00</b>
            <b>Change order 3</b><b>4 March</b><b>£25,000.00</b>
          </div>
          <div className="vf-bbox vf-bbox-a"><span>bbox 14</span></div>
          <div className="vf-bbox vf-bbox-b"><span>bbox 22</span></div>
        </div>
      </div>
      <div className="vf-read-output">
        <div className="vf-kicker">RECOVERED STRUCTURE</div>
        <h3>Layout becomes addressable evidence.</h3>
        <div className="vf-read-rows">
          {readRows.map(([kind, value, source], index) => (
            <div key={value} style={{ "--i": index } as React.CSSProperties}>
              <span>{kind}</span><strong>{value}</strong><small>{source}</small>
            </div>
          ))}
        </div>
        <div className="vf-proofline"><i /> Coordinates survive into Ask citations.</div>
      </div>
    </div>
  );
}

function Structure() {
  return (
    <div className="vf-stage vf-structure">
      <div className="vf-entity-column">
        <div className="vf-kicker">IDENTITY</div>
        <h3>Resolve the things that matter.</h3>
        <div className="vf-entity-list">
          {entities.map((entity, index) => <div key={entity} style={{ "--i": index } as React.CSSProperties}><i />{entity}<small>evidence bound</small></div>)}
        </div>
      </div>
      <div className="vf-graph-panel">
        <div className="vf-kicker">RELATION GRAPH</div>
        <svg viewBox="0 0 640 360" role="img" aria-label="Entity relation graph">
          <g className="vf-svg-edges">
            <path d="M115 100 C190 65 245 65 310 105" />
            <path d="M310 105 C375 120 430 92 515 86" />
            <path d="M115 100 C165 185 225 220 310 244" />
            <path d="M310 244 C395 225 450 230 525 265" />
            <path d="M310 105 C315 160 315 205 310 244" />
          </g>
          <g className="vf-svg-nodes">
            <g transform="translate(115 100)"><circle r="31"/><text y="5">Payment</text></g>
            <g transform="translate(310 105)"><circle r="27"/><text y="5">Invoice</text></g>
            <g transform="translate(515 86)"><circle r="29"/><text y="5">PO</text></g>
            <g transform="translate(310 244)"><circle r="28"/><text y="5">Finance</text></g>
            <g transform="translate(525 265)"><circle r="27"/><text y="5">Legal</text></g>
          </g>
        </svg>
        <div className="vf-relations"><span>PaymentTerms</span><b>constrains</b><span>Invoice</span><span>PurchaseOrder</span><b>must_cite</b><span>PaymentTerms</span></div>
      </div>
    </div>
  );
}

function World() {
  return (
    <div className="vf-stage vf-world">
      <div className="vf-world-canvas">
        <div className="vf-kicker">COMPILED WORLD · ACTIVE VIEW</div>
        <svg viewBox="0 0 100 82" preserveAspectRatio="none" role="img" aria-label="Compiled world graph">
          <g className="vf-world-edges">
            {worldEdges.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} style={{ "--i": i } as React.CSSProperties} />)}
          </g>
          <g className="vf-world-nodes">
            {worldNodes.map(([x, y, label], i) => (
              <g key={String(label)} transform={`translate(${x} ${y})`} style={{ "--i": i } as React.CSSProperties}>
                <circle r={i === 0 ? 4.6 : 3.6}/><text x="0" y={i === 0 ? 8 : 7}>{label}</text>
              </g>
            ))}
          </g>
        </svg>
      </div>
      <div className="vf-inspector">
        <div className="vf-kicker">EVIDENCE INSPECTOR</div>
        <h3>PaymentTerms</h3>
        <dl>
          <div><dt>TYPE</dt><dd>ContractClause</dd></div>
          <div><dt>DUE</dt><dd>P45D</dd></div>
          <div><dt>SOURCE</dt><dd>Services Agreement.pdf</dd></div>
          <div><dt>PAGE</dt><dd>7</dd></div>
          <div><dt>REGION</dt><dd>bbox 14</dd></div>
        </dl>
        <div className="vf-source-link"><i /> OPEN SOURCE EVIDENCE</div>
        <div className="vf-proofline"><i /> Ask · Search · API · MCP read the same World.</div>
      </div>
    </div>
  );
}

export default function CompileStageVectorFilm({ stage }: { stage: StageId }) {
  return (
    <div className={`vector-film vector-film-${stage}`} data-stage={stage} aria-hidden="true">
      <Chrome stage={stage} />
      <div className="vf-body">
        {stage === "sources" ? <Sources /> : stage === "read" ? <Read /> : stage === "structure" ? <Structure /> : <World />}
      </div>
    </div>
  );
}
