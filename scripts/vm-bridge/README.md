# VM HTTP bridge (Windows RDP / desktop control)

The Temporal worker does not implement RDP. It expects a small HTTP service at `PERCEO_VM_BRIDGE_URL` that translates REST calls into OS input and JPEG screenshots.

Contract: see `HttpWindowsVmBridge` in `apps/computer-use-agent/src/adapters/http-windows-bridge.ts` (paths `/screenshot`, `/click`, `/type`, `/scroll`, `/shortcut`, `/inject-audio`, `/capture-audio`, `/resolution`).

Typical deployment on **Google Cloud**:

- Run the bridge on the same Windows VM (loopback) or on a sidecar in the same VPC as the GCE instance.
- Restrict ingress to your worker egress IPs or use private networking + IAP.

Reference Python stacks mentioned in the PRD include **pyrdp** and **FreeRDP**; implement the HTTP façade in whichever language shares the process with your RDP client.

Full runbook: [docs/computer_use_gcp.md](../../docs/computer_use_gcp.md).
