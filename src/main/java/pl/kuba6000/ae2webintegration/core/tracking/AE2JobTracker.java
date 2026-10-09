package pl.kuba6000.ae2webintegration.core.tracking;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

import org.apache.commons.lang3.tuple.Pair;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import com.google.common.collect.MapMaker;

import pl.kuba6000.ae2webintegration.core.AE2Controller;
import pl.kuba6000.ae2webintegration.core.CoreEngine;
import pl.kuba6000.ae2webintegration.core.api.DimensionalCoords;
import pl.kuba6000.ae2webintegration.core.api.JSON_Stack;
import pl.kuba6000.ae2webintegration.core.config.Config;
import pl.kuba6000.ae2webintegration.core.grid.GridData;
import pl.kuba6000.ae2webintegration.core.grid.GridPersistentData;
import pl.kuba6000.ae2webintegration.core.identity.StableKey;
import pl.kuba6000.ae2webintegration.core.interfaces.IAECraftingPatternDetails;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGenericStack;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEGrid;
import pl.kuba6000.ae2webintegration.core.interfaces.IAEKey;
import pl.kuba6000.ae2webintegration.core.interfaces.ICraftingCPUCluster;
import pl.kuba6000.ae2webintegration.core.interfaces.IPatternProviderViewable;
import pl.kuba6000.ae2webintegration.core.interfaces.IStackList;
import pl.kuba6000.ae2webintegration.core.notification.NotificationManager;
import pl.kuba6000.ae2webintegration.core.notification.message.CraftingMessage;
import pl.kuba6000.ae2webintegration.core.notification.message.StatusMessage;

public class AE2JobTracker {

    public static class AEInterface {

        public String name;
        public HashSet<DimensionalCoords> location = new HashSet<>();
        /** Every resource a pattern pushed to a provider of this name was meant to produce. */
        public HashSet<IAEKey> produced = new HashSet<>();

        AEInterface(String name) {
            this.name = name;
        }

        @Override
        public int hashCode() {
            return name.hashCode();
        }

        @Override
        public boolean equals(Object obj) {
            if (!(obj instanceof AEInterface)) return false;
            return ((AEInterface) obj).name.equals(this.name);
        }
    }

    public static class JobTrackingInfo {

        public volatile @NotNull JSON_Stack finalOutput;
        public long timeStarted;
        public long timeDone;
        public HashMap<IAEKey, Long> timeSpentOn = new HashMap<>();
        public HashMap<IAEKey, Long> startedWaitingFor = new HashMap<>();
        public HashMap<IAEKey, Long> craftedTotal = new HashMap<>();
        public HashMap<IAEKey, Long> waitingFor = new HashMap<>();
        /** Inputs of every pushed pattern, summed per resource. */
        public HashMap<IAEKey, Long> consumedTotal = new HashMap<>();
        public HashMap<IAEKey, ArrayList<Pair<Long, Long>>> itemShare = new HashMap<>();
        public HashMap<AEInterface, ArrayList<Pair<Long, Long>>> interfaceShare = new HashMap<>();
        public HashMap<AEInterface, Long> interfaceStarted = new HashMap<>();
        public HashMap<String, AEInterface> interfaceLookup = new HashMap<>();
        public HashMap<AEInterface, HashSet<IAEKey>> interfaceWaitingFor = new HashMap<>();
        public HashMap<IAEKey, HashMap<AEInterface, HashSet<IAEKey>>> interfaceWaitingForLookup = new HashMap<>();
        /**
         * Units of each resource the job set out to craft, captured when it starts (and again on a merge) as
         * crafted + still expected + still to push. Fixed from then on, so it is the progress denominator.
         */
        public HashMap<IAEKey, Long> planned = new HashMap<>();
        public long plannedTotal;
        /** Sum of {@link #craftedTotal}. */
        public long craftedSum;
        /** Who submitted the job: a player, or the web user; null for a machine or when unknown. */
        public @Nullable String requestedBy;
        /** Last time anything was delivered back to the CPU, Unix epoch milliseconds. */
        public long lastProgressAt;
        /** {@link #lastProgressAt} once no progress was made for the configured stall time; zero otherwise. */
        public long stalledSince;
        /** What a stalled job is waiting on; null while it isn't stalled. */
        public @Nullable String stallReason;
        public boolean isDone = false;
        public boolean wasCancelled = false;

        public JobTrackingInfo(@NotNull JSON_Stack finalOutput) {
            this.finalOutput = finalOutput;
            this.timeStarted = System.currentTimeMillis();
            this.lastProgressAt = this.timeStarted;
        }

        void addCrafted(IAEKey key, long amount) {
            if (amount <= 0L) return;
            craftedTotal.merge(key, amount, Long::sum);
            craftedSum += amount;
            lastProgressAt = System.currentTimeMillis();
            stalledSince = 0L;
            stallReason = null;
        }

        /**
         * Recomputes {@link #planned} from what the CPU still has to do plus what was crafted so far. Skipped
         * when the platform can't enumerate the CPU, which leaves progress to the client's approximation.
         */
        void snapshotPlan(ICraftingCPUCluster cpu) {
            IStackList all = AE2Controller.AE2Interface == null ? null
                : AE2Controller.AE2Interface.web$createStackList();
            if (all == null) return;
            cpu.web$getAllItems(all);
            HashMap<IAEKey, Long> snapshot = new HashMap<>(craftedTotal);
            for (IAEGenericStack stack : all.web$stacks()) {
                IAEKey key = stack.web$what();
                long remaining = cpu.web$getActiveItems(key) + cpu.web$getPendingItems(key);
                if (remaining > 0L)
                    snapshot.put(key.web$copyIdentity(), craftedTotal.getOrDefault(key, 0L) + remaining);
            }
            planned = snapshot;
            long total = 0L;
            for (long amount : snapshot.values()) total += amount;
            plannedTotal = total;
        }

        public long getTimeSpentOn(IAEKey key) {
            Long time = timeSpentOn.get(key);
            if (time == null) return 0L;
            Long additionalTime = startedWaitingFor.get(key);
            if (additionalTime != null) {
                time += System.currentTimeMillis() - additionalTime;
            }
            return time;
        }

        public double getShareInCraftingTime(IAEKey key) {
            long total = 0L;
            long stackTime = 0L;
            for (IAEKey itemKey : timeSpentOn.keySet()) {
                long timeSpent = getTimeSpentOn(itemKey);
                total += timeSpent;
                if (key.equals(itemKey)) {
                    stackTime = timeSpent;
                }
            }
            if (total == 0L) return 1d;
            return (double) stackTime / (double) total;
        }
    }

    private static final ConcurrentMap<ICraftingCPUCluster, JobTrackingInfo> trackingInfoMap = new MapMaker().weakKeys()
        .makeMap();
    public ConcurrentHashMap<Integer, JobTrackingInfo> trackingInfos = new ConcurrentHashMap<>();

    private int nextFreeTrackingInfoID = 1;

    public static JobTrackingInfo findActiveJob(ICraftingCPUCluster cpu) {
        return trackingInfoMap.get(cpu);
    }

    public static void clearActiveJobs() {
        trackingInfoMap.clear();
    }

    public void clearHistory() {
        trackingInfos.clear();
        nextFreeTrackingInfoID = 1;
    }

    /**
     * Set by {@code SubmitCraftingPlan} around its native submit, which starts the job synchronously on the
     * same thread: the platform only sees the web integration's own action source, not the web user.
     */
    private static final ThreadLocal<String> WEB_REQUESTER = new ThreadLocal<>();

    public static void runAsWebRequester(@NotNull String username, @NotNull Runnable submit) {
        WEB_REQUESTER.set(username);
        try {
            submit.run();
        } finally {
            WEB_REQUESTER.remove();
        }
    }

    public static void addJob(ICraftingCPUCluster cpuCluster, IAEGrid grid, boolean isMerging) {
        addJob(cpuCluster, grid, isMerging, null);
    }

    public static void addJob(ICraftingCPUCluster cpuCluster, IAEGrid grid, boolean isMerging,
        @Nullable String requester) {
        if (!CoreEngine.GRID_IDENTITIES.isInitialized()) return;
        JobTrackingInfo info = isMerging ? trackingInfoMap.get(cpuCluster) : null;
        if (isMerging && info == null) return;
        if (!isMerging) {
            StableKey key = CoreEngine.GRID_IDENTITIES.getKey(grid);
            GridPersistentData data = key == null ? null : CoreEngine.GRID_IDENTITIES.getPersistentData(key);
            if (data == null || !data.getSettings()
                .isTracked()) return;
        }
        JSON_Stack finalOutput = JSON_Stack.capture(grid, cpuCluster.web$getFinalOutput());
        if (finalOutput == null) {
            trackingInfoMap.remove(cpuCluster);
            return;
        }
        if (isMerging) {
            info.finalOutput = finalOutput;
        } else {
            info = new JobTrackingInfo(finalOutput);
            String webRequester = WEB_REQUESTER.get();
            info.requestedBy = webRequester != null ? webRequester : requester;
            trackingInfoMap.put(cpuCluster, info);
        }
        info.snapshotPlan(cpuCluster);
    }

    public static void updateCraftingStatus(ICraftingCPUCluster cpu, Object diff) {
        JobTrackingInfo info = trackingInfoMap.get(cpu);
        if (info == null || !(diff instanceof IAEKey keyDiff)) return;
        IStackList waitingFor = cpu.web$getWaitingFor();
        long waitingAmount = waitingFor.web$getAmount(keyDiff);
        if (waitingAmount > 0L) {
            if (!info.startedWaitingFor.containsKey(keyDiff)) {
                info.startedWaitingFor.put(keyDiff, System.currentTimeMillis());
                info.timeSpentOn.putIfAbsent(keyDiff, 0L);
                info.waitingFor.put(keyDiff, waitingAmount);
            } else {
                long previous = info.waitingFor.get(keyDiff);
                if (previous > waitingAmount) {
                    info.addCrafted(keyDiff, previous - waitingAmount);
                }
                info.waitingFor.put(keyDiff, waitingAmount);
            }
        } else {
            if (info.startedWaitingFor.containsKey(keyDiff)) {
                long started = info.startedWaitingFor.remove(keyDiff);
                long ended = System.currentTimeMillis();
                long elapsed = ended - started;
                long endedReal = System.currentTimeMillis();
                info.timeSpentOn.merge(keyDiff, elapsed, Long::sum);
                info.addCrafted(keyDiff, info.waitingFor.remove(keyDiff));
                info.itemShare.computeIfAbsent(keyDiff, k -> new ArrayList<>())
                    .add(Pair.of(started, endedReal));
                if (info.interfaceWaitingForLookup.containsKey(keyDiff)) {
                    for (Map.Entry<AEInterface, HashSet<IAEKey>> entry : info.interfaceWaitingForLookup.get(keyDiff)
                        .entrySet()) {
                        AEInterface aeInterface = entry.getKey();
                        HashSet<IAEKey> itemList = entry.getValue();
                        itemList.remove(keyDiff);
                        if (itemList.isEmpty()) {
                            info.interfaceWaitingFor.remove(aeInterface);
                            long interfaceStarted = info.interfaceStarted.remove(aeInterface);
                            info.interfaceShare.computeIfAbsent(aeInterface, k -> new ArrayList<>())
                                .add(Pair.of(interfaceStarted, endedReal));
                        }
                    }
                    info.interfaceWaitingForLookup.remove(keyDiff);
                }
            }
        }
    }

    public static void pushedPattern(ICraftingCPUCluster cpu, IPatternProviderViewable provider,
        IAECraftingPatternDetails details) {
        JobTrackingInfo info = trackingInfoMap.get(cpu);
        if (info == null) return;
        for (IAEGenericStack in : details.web$getCondensedInputs()) {
            long amount = in.web$amount();
            if (amount <= 0L) continue;
            IAEKey inKey = in.web$what();
            Long previous = info.consumedTotal.get(inKey);
            if (previous == null) info.consumedTotal.put(inKey.web$copyIdentity(), amount);
            else info.consumedTotal.put(inKey, previous + amount);
        }
        if (provider != null) {
            String name = provider.web$getName();
            if (name == null) name = "[NULL]";
            final AEInterface aeInterface = info.interfaceLookup.computeIfAbsent(name, AEInterface::new);
            aeInterface.location.add(provider.web$getLocation());
            info.interfaceStarted.computeIfAbsent(aeInterface, k -> System.currentTimeMillis());
            final HashSet<IAEKey> itemList = info.interfaceWaitingFor
                .computeIfAbsent(aeInterface, k -> new HashSet<>());

            IAEGenericStack[] condensedOutputs = details.web$getCondensedOutputs();
            for (IAEGenericStack out : condensedOutputs) {
                IAEKey outKey = out.web$what();
                info.interfaceWaitingForLookup.computeIfAbsent(outKey, k -> new HashMap<>())
                    .putIfAbsent(aeInterface, itemList);
                itemList.add(outKey);
                aeInterface.produced.add(outKey);
            }
        }
    }

    public static void completeCrafting(@Nullable IAEGrid grid, ICraftingCPUCluster cpu) {
        JobTrackingInfo info = trackingInfoMap.remove(cpu);
        if (info == null || grid == null) return;
        StableKey key = CoreEngine.GRID_IDENTITIES.getKey(grid);
        GridPersistentData data = key == null ? null : CoreEngine.GRID_IDENTITIES.getPersistentData(key);
        if (data == null || !data.getSettings()
            .isTracked()) return;
        for (Map.Entry<IAEKey, Long> entry : info.waitingFor.entrySet()) {
            info.addCrafted(entry.getKey(), entry.getValue());
        }
        info.waitingFor.clear();
        final long now = System.currentTimeMillis();
        for (Map.Entry<IAEKey, Long> entry : info.startedWaitingFor.entrySet()) {
            info.timeSpentOn.merge(entry.getKey(), now - entry.getValue(), Long::sum);
            info.itemShare.computeIfAbsent(entry.getKey(), k -> new ArrayList<>())
                .add(Pair.of(entry.getValue(), now));
        }
        for (Map.Entry<AEInterface, Long> entry : info.interfaceStarted.entrySet()) {
            info.interfaceShare.computeIfAbsent(entry.getKey(), k -> new ArrayList<>())
                .add(Pair.of(entry.getValue(), now));
        }
        info.interfaceStarted.clear();
        info.interfaceWaitingFor.clear();
        info.interfaceWaitingForLookup.clear();
        info.interfaceLookup.clear();
        info.startedWaitingFor.clear();
        info.isDone = true;
        info.timeDone = now;
        GridData gridData = GridData.getOrCreate(key);
        gridData.trackingInfo.trackingInfos.put(gridData.trackingInfo.nextFreeTrackingInfoID++, info);
        long durationMillis = info.timeDone - info.timeStarted;
        long craftedAmount = info.finalOutput.quantity;
        if (!Config.INSTANCE.general.publicMode
            && NotificationManager.shouldPostCraftingNotification(durationMillis, craftedAmount)) {
            // Native enumeration assigns the fallback CPU display ordinals used by the notification name.
            grid.web$getCraftingGrid()
                .web$getCPUs();
            NotificationManager.postMessageNonBlocking(
                new CraftingMessage(
                    key,
                    cpu.web$getName(),
                    info.finalOutput.itemname,
                    craftedAmount,
                    NotificationManager.formatDuration(durationMillis),
                    info.wasCancelled));
        }
    }

    public static void cancelCrafting(@Nullable IAEGrid grid, ICraftingCPUCluster cpu) {
        JobTrackingInfo info = trackingInfoMap.get(cpu);
        if (info == null) return;
        info.wasCancelled = true;
        completeCrafting(grid, cpu);
    }

    /**
     * Marks running jobs that delivered nothing for {@code stallMillis} as stalled, and posts one notification
     * per stall; progress clears the mark ({@link JobTrackingInfo#addCrafted}). Runs on the server thread.
     */
    public static void checkStalls(long nowMillis, long stallMillis) {
        if (stallMillis <= 0L) return;
        for (Map.Entry<ICraftingCPUCluster, JobTrackingInfo> entry : trackingInfoMap.entrySet()) {
            JobTrackingInfo info = entry.getValue();
            if (nowMillis - info.lastProgressAt < stallMillis) continue;
            info.stallReason = stallReason(info);
            if (info.stalledSince != 0L) continue;
            info.stalledSince = info.lastProgressAt;
            if (Config.INSTANCE.general.publicMode) continue;
            ICraftingCPUCluster cpu = entry.getKey();
            NotificationManager.postMessageNonBlocking(
                new StatusMessage(
                    "Crafting stalled on " + cpu.web$getName(),
                    "No progress for " + NotificationManager.formatDuration(nowMillis - info.lastProgressAt)
                        + " crafting "
                        + info.finalOutput.quantity
                        + "x "
                        + info.finalOutput.itemname
                        + ". "
                        + info.stallReason,
                    StatusMessage.Severity.WARNING));
        }
    }

    /** The machine the job has waited on longest, or that nothing is out at a machine at all. */
    static @NotNull String stallReason(JobTrackingInfo info) {
        AEInterface oldest = null;
        long oldestSince = Long.MAX_VALUE;
        for (Map.Entry<AEInterface, Long> started : info.interfaceStarted.entrySet()) {
            if (started.getValue() < oldestSince) {
                oldest = started.getKey();
                oldestSince = started.getValue();
            }
        }
        if (oldest == null) return "Nothing is out at a machine - waiting for ingredients or a free machine.";
        StringBuilder reason = new StringBuilder("Waiting on ").append(oldest.name);
        DimensionalCoords location = oldest.location.isEmpty() ? null : Collections.min(oldest.location);
        if (location != null) {
            reason.append(" at ")
                .append(location.x())
                .append(", ")
                .append(location.y())
                .append(", ")
                .append(location.z());
        }
        HashSet<IAEKey> waiting = info.interfaceWaitingFor.get(oldest);
        if (waiting != null && !waiting.isEmpty()) {
            reason.append(" for ")
                .append(
                    waiting.iterator()
                        .next()
                        .web$getDisplayName());
            if (waiting.size() > 1) reason.append(" and ")
                .append(waiting.size() - 1)
                .append(" more");
        }
        return reason.append('.')
            .toString();
    }
}
