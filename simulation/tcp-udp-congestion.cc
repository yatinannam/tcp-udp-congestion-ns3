// TCP-UDP-CONGESTION-DEMO: managed by scripts/run_experiments.py (safe to overwrite)
/*
 * Performance Analysis of TCP and UDP Under Network Congestion Using NS-3
 *
 * Six-node dumbbell. Every data packet crosses the single RouterA -> RouterB
 * bottleneck, where a DropTail (FIFO) queue disc of fixed size is installed.
 *
 *   TCP sender (n0) --\                                 /-- TCP receiver (n4)
 *        10.1.1.0/24   \                               /   10.1.4.0/24
 *                       RouterA (n2) ======== RouterB (n3)
 *        10.1.2.0/24   /     10.1.3.0/24 BOTTLENECK    \   10.1.5.0/24
 *   UDP sender (n1) --/                                 \-- UDP receiver (n5)
 *
 * Modes:
 *   baseline  - one paced flow (TCP or UDP, --protocol) at --appRateMbps,
 *               default 20 Mbps bottleneck (low load)
 *   udp-sweep - one UDP CBR flow at --udpRateMbps over a 5 Mbps bottleneck
 *   tcp-bulk  - one TCP BulkSend flow over a 5 Mbps bottleneck
 *   mixed     - TCP BulkSend + UDP CBR (default 3 Mbps) sharing the bottleneck
 *
 * Output (in --outputDir): summary.csv, timeseries.csv, cwnd.csv, flowmon.xml
 * and optionally bottleneck pcap files.
 */

#include "ns3/applications-module.h"
#include "ns3/core-module.h"
#include "ns3/flow-monitor-module.h"
#include "ns3/internet-module.h"
#include "ns3/network-module.h"
#include "ns3/point-to-point-module.h"
#include "ns3/traffic-control-module.h"

#include <algorithm>
#include <cmath>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <map>
#include <optional>
#include <sstream>
#include <string>
#include <vector>

using namespace ns3;

NS_LOG_COMPONENT_DEFINE("TcpUdpCongestion");

namespace
{

constexpr uint16_t kTcpPort = 5000;
constexpr uint16_t kUdpPort = 6000;
const std::string kTcpVariant = "ns3::TcpNewReno";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

struct SimConfig
{
    std::string mode = "mixed";
    std::string protocol = "tcp"; // baseline only
    double bottleneckMbps = -1;   // -1 = mode default (baseline 20, others 5)
    double bottleneckDelayMs = 10;
    uint32_t queuePackets = 50;
    double udpRateMbps = -1; // -1 = mode default (udp-sweep 8, mixed 3)
    double appRateMbps = 2;  // baseline paced rate
    uint32_t packetSize = 1024;
    double accessMbps = 100;
    double accessDelayMs = 1;
    double appStart = 1;
    double appStop = 10;
    double simStop = 12;
    double binSize = 0.5;
    uint32_t seed = 1;
    uint32_t run = 1;
    std::string outputDir = "tcp-udp-results";
    std::string runId;
    bool pcap = false;
};

/// Fill in mode-dependent defaults for values left at -1.
void
ApplyModeDefaults(SimConfig& c)
{
    if (c.bottleneckMbps < 0)
    {
        c.bottleneckMbps = (c.mode == "baseline") ? 20.0 : 5.0;
    }
    if (c.udpRateMbps < 0)
    {
        c.udpRateMbps = (c.mode == "mixed") ? 3.0 : 8.0;
    }
    if (c.runId.empty())
    {
        c.runId = c.mode;
    }
}

/// Returns an empty string when the configuration is valid, otherwise an error message.
std::string
Validate(const SimConfig& c)
{
    const std::vector<std::string> modes = {"baseline", "udp-sweep", "tcp-bulk", "mixed"};
    if (std::find(modes.begin(), modes.end(), c.mode) == modes.end())
    {
        return "unknown --mode '" + c.mode + "' (use baseline, udp-sweep, tcp-bulk or mixed)";
    }
    if (c.protocol != "tcp" && c.protocol != "udp")
    {
        return "--protocol must be 'tcp' or 'udp'";
    }
    if (c.bottleneckMbps <= 0 || c.accessMbps <= 0)
    {
        return "link bandwidths must be > 0 Mbps";
    }
    if (c.bottleneckDelayMs < 0 || c.accessDelayMs < 0)
    {
        return "link delays must be >= 0 ms";
    }
    if (c.udpRateMbps <= 0 || c.appRateMbps <= 0)
    {
        return "application rates must be > 0 Mbps";
    }
    if (c.queuePackets < 1)
    {
        return "--queuePackets must be >= 1";
    }
    if (c.packetSize < 12 || c.packetSize > 1400)
    {
        return "--packetSize must be between 12 and 1400 bytes (fits a 1500-byte MTU)";
    }
    if (c.appStart < 0 || c.appStart >= c.appStop)
    {
        return "need 0 <= --appStart < --appStop";
    }
    if (c.simStop <= c.appStop)
    {
        return "--simStop must be later than --appStop so in-flight packets can drain";
    }
    if (c.binSize <= 0)
    {
        return "--binSize must be > 0";
    }
    if (c.seed < 1 || c.run < 1)
    {
        return "--seed and --run must be >= 1";
    }
    if (c.accessMbps <= c.bottleneckMbps)
    {
        return "--accessMbps must exceed --bottleneckMbps, otherwise the access link "
               "becomes the bottleneck";
    }
    return "";
}

// ---------------------------------------------------------------------------
// Measurement state (filled by trace callbacks)
// ---------------------------------------------------------------------------

/// Per-flow, receiver-side application measurements.
struct FlowStats
{
    std::string name;     // "tcp" or "udp"
    std::string protocol; // "TCP" or "UDP"
    std::string app;      // "OnOff" or "BulkSend"
    bool active = false;
    std::optional<double> requestedMbps; // nullopt for BulkSend (no target rate)

    double windowStart = 0;
    double windowStop = 0;
    double binSize = 1;

    uint64_t rxBytesWindow = 0; // payload bytes received inside [appStart, appStop]
    uint64_t rxBytesTotal = 0;  // payload bytes received during the whole simulation
    uint64_t rxPackets = 0;     // PacketSink Rx events (= packets for UDP)
    uint64_t txPackets = 0;     // OnOff Tx events (packets handed to the socket)
    std::map<uint32_t, uint64_t> binBytes;
};

/// TCP congestion window samples from the CongestionWindow trace source.
struct CwndLog
{
    bool connected = false;
    std::vector<std::pair<double, uint32_t>> samples;
};

/// Bottleneck queue observations.
struct QueueStats
{
    double binSize = 1;
    uint64_t discDrops = 0;   // FIFO queue disc drops (the real congestion drops)
    uint64_t deviceDrops = 0; // NetDevice TxQueue drops (expected to stay 0)
    std::map<uint32_t, uint64_t> dropBins;
    std::map<uint32_t, uint32_t> maxLenBins;
};

uint32_t
BinOf(double t, double binSize)
{
    return static_cast<uint32_t>(std::floor(t / binSize));
}

// --- Trace callbacks -------------------------------------------------------

/// PacketSink "Rx": counts application payload bytes delivered to the receiver.
void
SinkRx(FlowStats* f, Ptr<const Packet> packet, const Address& /*from*/)
{
    const double t = Simulator::Now().GetSeconds();
    const uint32_t n = packet->GetSize();
    f->rxBytesTotal += n;
    f->rxPackets++;
    if (t >= f->windowStart && t <= f->windowStop)
    {
        f->rxBytesWindow += n;
    }
    f->binBytes[BinOf(t, f->binSize)] += n;
}

/// OnOffApplication "Tx": a packet was accepted by the sending socket.
void
AppTx(FlowStats* f, Ptr<const Packet> /*packet*/)
{
    f->txPackets++;
}

/// TcpSocketBase "CongestionWindow" (TracedValue<uint32_t>).
void
CwndChange(CwndLog* log, uint32_t oldCwnd, uint32_t newCwnd)
{
    const double t = Simulator::Now().GetSeconds();
    if (log->samples.empty())
    {
        log->samples.emplace_back(t, oldCwnd); // value before the first change
    }
    log->samples.emplace_back(t, newCwnd);
}

/// QueueDisc "Drop": the bottleneck FIFO discarded a packet.
void
QueueDiscDrop(QueueStats* q, Ptr<const QueueDiscItem> /*item*/)
{
    q->discDrops++;
    q->dropBins[BinOf(Simulator::Now().GetSeconds(), q->binSize)]++;
}

/// QueueDisc "PacketsInQueue": track the peak queue length in each time bin.
void
QueueLength(QueueStats* q, uint32_t /*oldLen*/, uint32_t newLen)
{
    uint32_t& peak = q->maxLenBins[BinOf(Simulator::Now().GetSeconds(), q->binSize)];
    peak = std::max(peak, newLen);
}

/// Device-level TxQueue "Drop" (sanity check: should not happen behind the queue disc).
void
DeviceDrop(QueueStats* q, Ptr<const Packet> /*packet*/)
{
    q->deviceDrops++;
}

/// Hook the congestion window of the TCP sender's first socket. The socket only
/// exists once the application has started, so this is scheduled just after appStart.
void
ConnectCwndTrace(uint32_t nodeId, CwndLog* log)
{
    std::ostringstream path;
    path << "/NodeList/" << nodeId << "/$ns3::TcpL4Protocol/SocketList/0/CongestionWindow";
    log->connected =
        Config::ConnectWithoutContextFailSafe(path.str(), MakeBoundCallback(&CwndChange, log));
    if (!log->connected)
    {
        std::cerr << "WARNING: could not connect " << path.str() << "\n";
    }
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------

struct Topology
{
    NodeContainer nodes; // n0..n5 as in the diagram
    Ipv4Address tcpReceiverAddr;
    Ipv4Address udpReceiverAddr;
    Ptr<QueueDisc> bottleneckQueue; // RouterA egress toward RouterB
    Ptr<NetDevice> bottleneckDevice;

    Ptr<Node> TcpSender() const { return nodes.Get(0); }
    Ptr<Node> UdpSender() const { return nodes.Get(1); }
    Ptr<Node> TcpReceiver() const { return nodes.Get(4); }
    Ptr<Node> UdpReceiver() const { return nodes.Get(5); }
};

Topology
BuildTopology(const SimConfig& c)
{
    Topology topo;
    topo.nodes.Create(6);
    Ptr<Node> routerA = topo.nodes.Get(2);
    Ptr<Node> routerB = topo.nodes.Get(3);

    // The Internet stack must exist before the queue disc is installed, and the
    // queue disc must be installed before IP addresses are assigned (otherwise
    // ns-3 installs its default queue disc on the device).
    InternetStackHelper stack;
    stack.Install(topo.nodes);

    PointToPointHelper access;
    access.SetDeviceAttribute("DataRate", DataRateValue(DataRate(c.accessMbps * 1e6)));
    access.SetChannelAttribute("Delay", TimeValue(MilliSeconds(c.accessDelayMs)));

    PointToPointHelper bottleneck;
    bottleneck.SetDeviceAttribute("DataRate", DataRateValue(DataRate(c.bottleneckMbps * 1e6)));
    bottleneck.SetChannelAttribute("Delay", TimeValue(MilliSeconds(c.bottleneckDelayMs)));
    // Keep the device queue tiny so the queue disc below is the real buffer.
    bottleneck.SetQueue("ns3::DropTailQueue<Packet>", "MaxSize", StringValue("1p"));

    NetDeviceContainer d1 = access.Install(topo.TcpSender(), routerA);
    NetDeviceContainer d2 = access.Install(topo.UdpSender(), routerA);
    NetDeviceContainer d3 = bottleneck.Install(routerA, routerB);
    NetDeviceContainer d4 = access.Install(routerB, topo.TcpReceiver());
    NetDeviceContainer d5 = access.Install(routerB, topo.UdpReceiver());

    // DropTail behaviour: FIFO with a fixed packet limit on both bottleneck ends.
    TrafficControlHelper tch;
    tch.SetRootQueueDisc("ns3::FifoQueueDisc",
                         "MaxSize",
                         QueueSizeValue(QueueSize(QueueSizeUnit::PACKETS, c.queuePackets)));
    QueueDiscContainer qdiscs = tch.Install(d3);
    topo.bottleneckQueue = qdiscs.Get(0); // d3.Get(0) is RouterA's side
    topo.bottleneckDevice = d3.Get(0);

    Ipv4AddressHelper addr;
    addr.SetBase("10.1.1.0", "255.255.255.0");
    addr.Assign(d1);
    addr.SetBase("10.1.2.0", "255.255.255.0");
    addr.Assign(d2);
    addr.SetBase("10.1.3.0", "255.255.255.0");
    addr.Assign(d3);
    addr.SetBase("10.1.4.0", "255.255.255.0");
    topo.tcpReceiverAddr = addr.Assign(d4).GetAddress(1);
    addr.SetBase("10.1.5.0", "255.255.255.0");
    topo.udpReceiverAddr = addr.Assign(d5).GetAddress(1);

    Ipv4GlobalRoutingHelper::PopulateRoutingTables();

    if (c.pcap)
    {
        bottleneck.EnablePcap(c.outputDir + "/bottleneck", d3.Get(0), true);
    }
    return topo;
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

/// Install a PacketSink on the receiver and connect its Rx trace.
void
InstallSink(const SimConfig& c, const std::string& factory, Ptr<Node> node, uint16_t port, FlowStats* f)
{
    PacketSinkHelper sinkHelper(factory, InetSocketAddress(Ipv4Address::GetAny(), port));
    ApplicationContainer sink = sinkHelper.Install(node);
    sink.Start(Seconds(0));
    sink.Stop(Seconds(c.simStop));
    sink.Get(0)->TraceConnectWithoutContext("Rx", MakeBoundCallback(&SinkRx, f));
}

/// Constant-rate OnOff source (always on). Works over UDP or TCP sockets; over TCP
/// it caches a packet the socket cannot accept yet and retries (backpressure).
void
InstallPacedSource(const SimConfig& c,
                   const std::string& factory,
                   Ptr<Node> node,
                   Address remote,
                   double rateMbps,
                   FlowStats* f)
{
    OnOffHelper onoff(factory, remote);
    onoff.SetConstantRate(DataRate(rateMbps * 1e6), c.packetSize);
    ApplicationContainer app = onoff.Install(node);
    app.Start(Seconds(c.appStart));
    app.Stop(Seconds(c.appStop));
    app.Get(0)->TraceConnectWithoutContext("Tx", MakeBoundCallback(&AppTx, f));
    f->app = "OnOff";
    f->requestedMbps = rateMbps;
}

/// Greedy TCP source: sends as fast as TCP congestion control allows.
void
InstallBulkSource(const SimConfig& c, Ptr<Node> node, Address remote, FlowStats* f)
{
    BulkSendHelper bulk("ns3::TcpSocketFactory", remote);
    bulk.SetAttribute("MaxBytes", UintegerValue(0)); // unlimited
    bulk.SetAttribute("SendSize", UintegerValue(c.packetSize));
    ApplicationContainer app = bulk.Install(node);
    app.Start(Seconds(c.appStart));
    app.Stop(Seconds(c.appStop));
    f->app = "BulkSend";
    f->requestedMbps.reset();
}

void
InstallApplications(const SimConfig& c, const Topology& topo, FlowStats& tcp, FlowStats& udp)
{
    const Address tcpRemote = InetSocketAddress(topo.tcpReceiverAddr, kTcpPort);
    const Address udpRemote = InetSocketAddress(topo.udpReceiverAddr, kUdpPort);

    const bool baseline = (c.mode == "baseline");
    tcp.active = (baseline && c.protocol == "tcp") || c.mode == "tcp-bulk" || c.mode == "mixed";
    udp.active = (baseline && c.protocol == "udp") || c.mode == "udp-sweep" || c.mode == "mixed";

    if (tcp.active)
    {
        InstallSink(c, "ns3::TcpSocketFactory", topo.TcpReceiver(), kTcpPort, &tcp);
        if (baseline)
        {
            InstallPacedSource(c, "ns3::TcpSocketFactory", topo.TcpSender(), tcpRemote,
                               c.appRateMbps, &tcp);
        }
        else
        {
            InstallBulkSource(c, topo.TcpSender(), tcpRemote, &tcp);
        }
    }
    if (udp.active)
    {
        InstallSink(c, "ns3::UdpSocketFactory", topo.UdpReceiver(), kUdpPort, &udp);
        const double rate = baseline ? c.appRateMbps : c.udpRateMbps;
        InstallPacedSource(c, "ns3::UdpSocketFactory", topo.UdpSender(), udpRemote, rate, &udp);
    }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/// FlowMonitor results for the data direction of one flow.
struct FmResult
{
    bool found = false;
    uint64_t txPackets = 0, rxPackets = 0, txBytes = 0, rxBytes = 0, lostPackets = 0;
    std::optional<double> meanDelayMs;
    std::optional<double> meanJitterMs;
};

FmResult
FindDataFlow(Ptr<FlowMonitor> monitor, Ptr<Ipv4FlowClassifier> classifier, uint8_t proto, uint16_t port)
{
    FmResult r;
    for (const auto& [id, st] : monitor->GetFlowStats())
    {
        Ipv4FlowClassifier::FiveTuple t = classifier->FindFlow(id);
        // Data direction only: TCP ACKs travel back with sourcePort == port.
        if (t.protocol != proto || t.destinationPort != port)
        {
            continue;
        }
        r.found = true;
        r.txPackets = st.txPackets;
        r.rxPackets = st.rxPackets;
        r.txBytes = st.txBytes;
        r.rxBytes = st.rxBytes;
        r.lostPackets = st.lostPackets;
        if (st.rxPackets > 0)
        {
            r.meanDelayMs = st.delaySum.GetSeconds() * 1e3 / st.rxPackets;
        }
        if (st.rxPackets > 1) // jitter is measured between consecutive received packets
        {
            r.meanJitterMs = st.jitterSum.GetSeconds() * 1e3 / (st.rxPackets - 1);
        }
    }
    return r;
}

std::string
Num(std::optional<double> v, int precision = 6)
{
    if (!v.has_value() || !std::isfinite(*v))
    {
        return ""; // blank = not measured / not meaningful
    }
    std::ostringstream os;
    os << std::fixed << std::setprecision(precision) << *v;
    return os.str();
}

void
WriteSummary(const SimConfig& c,
             const std::vector<std::pair<const FlowStats*, FmResult>>& flows,
             const QueueStats& q,
             const CwndLog& cwnd)
{
    std::ofstream out(c.outputDir + "/summary.csv");
    out << "run_id,experiment,flow,protocol,application,bottleneck_mbps,bottleneck_delay_ms,"
           "queue_packets,packet_size_bytes,requested_rate_mbps,tcp_variant,app_start_s,"
           "app_stop_s,sim_stop_s,goodput_window_s,app_rx_bytes_window,app_goodput_mbps,"
           "app_rx_bytes_total,app_tx_packets,app_rx_packets,udp_loss_pct,fm_tx_packets,"
           "fm_rx_packets,fm_tx_bytes,fm_rx_bytes,fm_lost_packets,mean_delay_ms,mean_jitter_ms,"
           "bottleneck_queue_drops,device_queue_drops,cwnd_trace,seed,run\n";

    const double window = c.appStop - c.appStart;
    for (const auto& [f, fm] : flows)
    {
        const bool isUdp = (f->protocol == "UDP");
        const double goodput = f->rxBytesWindow * 8.0 / window / 1e6;
        std::optional<double> loss;
        if (isUdp && f->txPackets > 0)
        {
            loss = 100.0 * (static_cast<double>(f->txPackets) - f->rxPackets) / f->txPackets;
        }
        std::string cwndStatus = "n/a";
        if (!isUdp)
        {
            cwndStatus = (cwnd.connected && !cwnd.samples.empty()) ? "ok" : "unavailable";
        }

        out << c.runId << ',' << c.mode << ',' << f->name << ',' << f->protocol << ','
            << f->app << ',' << Num(c.bottleneckMbps, 3) << ',' << Num(c.bottleneckDelayMs, 3)
            << ',' << c.queuePackets << ',' << c.packetSize << ',' << Num(f->requestedMbps, 3)
            << ',' << (isUdp ? "" : kTcpVariant) << ',' << Num(c.appStart, 3) << ','
            << Num(c.appStop, 3) << ',' << Num(c.simStop, 3) << ',' << Num(window, 3) << ','
            << f->rxBytesWindow << ',' << Num(goodput) << ',' << f->rxBytesTotal << ','
            // OnOff counts packets written to the socket; BulkSend has no such trace.
            << (f->app == "OnOff" ? std::to_string(f->txPackets) : "") << ','
            // Sink Rx events equal packets only for UDP (TCP delivers a byte stream).
            << (isUdp ? std::to_string(f->rxPackets) : "") << ',' << Num(loss, 4) << ',';
        if (fm.found)
        {
            out << fm.txPackets << ',' << fm.rxPackets << ',' << fm.txBytes << ',' << fm.rxBytes
                << ',' << fm.lostPackets << ',';
        }
        else
        {
            out << ",,,,,";
        }
        out << Num(fm.meanDelayMs, 4) << ',' << Num(fm.meanJitterMs, 4) << ',' << q.discDrops
            << ',' << q.deviceDrops << ',' << cwndStatus << ',' << c.seed << ',' << c.run << '\n';
    }
}

/// Last congestion window value at or before time t (nullopt before the first sample).
std::optional<double>
CwndAt(const CwndLog& log, double t)
{
    std::optional<double> v;
    for (const auto& [ts, cw] : log.samples)
    {
        if (ts > t)
        {
            break;
        }
        v = cw;
    }
    return v;
}

void
WriteTimeSeries(const SimConfig& c,
                const std::vector<const FlowStats*>& flows,
                const QueueStats& q,
                const CwndLog& cwnd)
{
    std::ofstream out(c.outputDir + "/timeseries.csv");
    // time_s is the start of the bin; goodput is payload bytes received in the bin.
    out << "run_id,experiment,time_s,bin_s,flow,goodput_mbps,cwnd_bytes,queue_drops_cum,"
           "queue_len_max_pkts\n";
    const uint32_t nBins = static_cast<uint32_t>(std::ceil(c.simStop / c.binSize));
    uint64_t dropsCum = 0;
    for (uint32_t b = 0; b < nBins; ++b)
    {
        const double t = b * c.binSize;
        for (const FlowStats* f : flows)
        {
            auto it = f->binBytes.find(b);
            const uint64_t bytes = (it == f->binBytes.end()) ? 0 : it->second;
            std::optional<double> cw;
            if (f->protocol == "TCP" && cwnd.connected)
            {
                cw = CwndAt(cwnd, t + c.binSize);
            }
            out << c.runId << ',' << c.mode << ',' << Num(t, 3) << ',' << Num(c.binSize, 3) << ','
                << f->name << ',' << Num(bytes * 8.0 / c.binSize / 1e6) << ',' << Num(cw, 0)
                << ",,\n";
        }
        auto d = q.dropBins.find(b);
        dropsCum += (d == q.dropBins.end()) ? 0 : d->second;
        auto l = q.maxLenBins.find(b);
        const uint32_t qlen = (l == q.maxLenBins.end()) ? 0 : l->second;
        out << c.runId << ',' << c.mode << ',' << Num(t, 3) << ',' << Num(c.binSize, 3)
            << ",bottleneck,,," << dropsCum << ',' << qlen << '\n';
    }
}

void
WriteCwnd(const SimConfig& c, const CwndLog& cwnd)
{
    std::ofstream out(c.outputDir + "/cwnd.csv");
    out << "run_id,experiment,time_s,cwnd_bytes\n";
    for (const auto& [t, cw] : cwnd.samples)
    {
        out << c.runId << ',' << c.mode << ',' << Num(t) << ',' << cw << '\n';
    }
}

void
PrintConsoleSummary(const SimConfig& c,
                    const std::vector<std::pair<const FlowStats*, FmResult>>& flows,
                    const QueueStats& q,
                    const CwndLog& cwnd)
{
    const double window = c.appStop - c.appStart;
    std::cout << "=== " << c.runId << " (mode=" << c.mode << ") ===\n"
              << "Bottleneck: " << c.bottleneckMbps << " Mbps, " << c.bottleneckDelayMs
              << " ms, FIFO " << c.queuePackets << " packets\n"
              << "Goodput window: " << c.appStart << "-" << c.appStop << " s (" << window
              << " s)\n";
    for (const auto& [f, fm] : flows)
    {
        std::cout << "[" << f->protocol << " " << f->app << "]";
        if (f->requestedMbps)
        {
            std::cout << " requested " << *f->requestedMbps << " Mbps,";
        }
        std::cout << " goodput " << std::fixed << std::setprecision(3)
                  << f->rxBytesWindow * 8.0 / window / 1e6 << " Mbps, rx " << f->rxBytesTotal
                  << " B total";
        if (f->protocol == "UDP" && f->txPackets > 0)
        {
            std::cout << ", tx " << f->txPackets << " pkts, rx " << f->rxPackets
                      << " pkts, loss "
                      << 100.0 * (static_cast<double>(f->txPackets) - f->rxPackets) / f->txPackets
                      << " %";
        }
        std::cout << ", delay " << (fm.meanDelayMs ? Num(fm.meanDelayMs, 2) : "n/a") << " ms"
                  << ", jitter " << (fm.meanJitterMs ? Num(fm.meanJitterMs, 3) : "n/a")
                  << " ms\n";
        if (f->rxBytesTotal == 0)
        {
            std::cout << "  WARNING: receiver got no data for this flow\n";
        }
    }
    std::cout << "Bottleneck queue drops: " << q.discDrops << " (device queue drops "
              << q.deviceDrops << ")\n";
    if (cwnd.connected)
    {
        std::cout << "Cwnd samples: " << cwnd.samples.size() << "\n";
    }
    std::cout.unsetf(std::ios::fixed);
}

} // namespace

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

int
main(int argc, char* argv[])
{
    SimConfig c;
    CommandLine cmd(__FILE__);
    cmd.AddValue("mode", "Experiment: baseline | udp-sweep | tcp-bulk | mixed", c.mode);
    cmd.AddValue("protocol", "Baseline transport: tcp | udp", c.protocol);
    cmd.AddValue("bottleneckMbps", "Bottleneck rate in Mbps (-1 = mode default)", c.bottleneckMbps);
    cmd.AddValue("bottleneckDelayMs", "Bottleneck one-way delay in ms", c.bottleneckDelayMs);
    cmd.AddValue("queuePackets", "Bottleneck FIFO capacity in packets", c.queuePackets);
    cmd.AddValue("udpRateMbps", "UDP CBR rate in Mbps (-1 = mode default)", c.udpRateMbps);
    cmd.AddValue("appRateMbps", "Baseline paced application rate in Mbps", c.appRateMbps);
    cmd.AddValue("packetSize", "Application payload size in bytes", c.packetSize);
    cmd.AddValue("accessMbps", "Access link rate in Mbps", c.accessMbps);
    cmd.AddValue("accessDelayMs", "Access link one-way delay in ms", c.accessDelayMs);
    cmd.AddValue("appStart", "Application start time (s)", c.appStart);
    cmd.AddValue("appStop", "Application stop time (s)", c.appStop);
    cmd.AddValue("simStop", "Simulation stop time (s)", c.simStop);
    cmd.AddValue("binSize", "Time-series bin width (s)", c.binSize);
    cmd.AddValue("seed", "RNG seed", c.seed);
    cmd.AddValue("run", "RNG run number", c.run);
    cmd.AddValue("outputDir", "Directory for CSV/XML/pcap output", c.outputDir);
    cmd.AddValue("runId", "Run label written to the CSVs (default: mode)", c.runId);
    cmd.AddValue("pcap", "Write pcap traces of the bottleneck link", c.pcap);
    cmd.Parse(argc, argv);

    ApplyModeDefaults(c);
    if (const std::string err = Validate(c); !err.empty())
    {
        std::cerr << "ERROR: " << err << "\n";
        return 1;
    }
    std::filesystem::create_directories(c.outputDir);

    // Reproducibility. The scenario has no random elements, so changing the seed
    // is not expected to change results; it is recorded for completeness.
    RngSeedManager::SetSeed(c.seed);
    RngSeedManager::SetRun(c.run);

    // Explicit TCP configuration.
    Config::SetDefault("ns3::TcpL4Protocol::SocketType", TypeIdValue(TypeId::LookupByName(kTcpVariant)));
    Config::SetDefault("ns3::TcpSocket::SegmentSize", UintegerValue(c.packetSize));

    Topology topo = BuildTopology(c);

    FlowStats tcp;
    tcp.name = "tcp";
    tcp.protocol = "TCP";
    FlowStats udp;
    udp.name = "udp";
    udp.protocol = "UDP";
    for (FlowStats* f : {&tcp, &udp})
    {
        f->windowStart = c.appStart;
        f->windowStop = c.appStop;
        f->binSize = c.binSize;
    }
    InstallApplications(c, topo, tcp, udp);

    // Bottleneck queue tracing.
    QueueStats q;
    q.binSize = c.binSize;
    topo.bottleneckQueue->TraceConnectWithoutContext("Drop", MakeBoundCallback(&QueueDiscDrop, &q));
    topo.bottleneckQueue->TraceConnectWithoutContext("PacketsInQueue",
                                                     MakeBoundCallback(&QueueLength, &q));
    DynamicCast<PointToPointNetDevice>(topo.bottleneckDevice)
        ->GetQueue()
        ->TraceConnectWithoutContext("Drop", MakeBoundCallback(&DeviceDrop, &q));

    CwndLog cwnd;
    if (tcp.active)
    {
        Simulator::Schedule(Seconds(c.appStart) + MilliSeconds(1),
                            &ConnectCwndTrace,
                            topo.TcpSender()->GetId(),
                            &cwnd);
    }

    FlowMonitorHelper fmHelper;
    Ptr<FlowMonitor> monitor = fmHelper.InstallAll();

    Simulator::Stop(Seconds(c.simStop));
    Simulator::Run();

    monitor->CheckForLostPackets();
    auto classifier = DynamicCast<Ipv4FlowClassifier>(fmHelper.GetClassifier());

    std::vector<std::pair<const FlowStats*, FmResult>> results;
    std::vector<const FlowStats*> active;
    if (tcp.active)
    {
        results.emplace_back(&tcp, FindDataFlow(monitor, classifier, 6, kTcpPort));
        active.push_back(&tcp);
    }
    if (udp.active)
    {
        results.emplace_back(&udp, FindDataFlow(monitor, classifier, 17, kUdpPort));
        active.push_back(&udp);
    }

    WriteSummary(c, results, q, cwnd);
    WriteTimeSeries(c, active, q, cwnd);
    WriteCwnd(c, cwnd);
    monitor->SerializeToXmlFile(c.outputDir + "/flowmon.xml", true, true);
    PrintConsoleSummary(c, results, q, cwnd);

    Simulator::Destroy();
    return 0;
}
