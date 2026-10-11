// The recipe a GregTech machine is running, as inputs -> outputs. A compact strip of item slots for the
// machine cards (amount overlaid on the icon like an inventory slot) and a labelled list for the drawer.
import type { GTStack } from "../api/types";
import { cx } from "../ui/cx";
import { RecipeArrowIcon } from "../ui/icons";
import { ItemIcon } from "../ui/ItemIcon";
import { RecipePercent } from "./gtCommon";
import { formatGTAmount } from "./gtModel";
import type { RecipeClock } from "./gtModel";

/** Slots shown per side on a card before the rest fold into a "+N" slot. */
const CARD_SLOTS = 4;

function describe(s: GTStack, numberFormat: "full" | "compact"): string {
    return `${formatGTAmount(s.amount, s.fluid, numberFormat)} ${s.name}`;
}

/** Inventory-slot style: no count for a single item, and no space before a fluid unit so it fits. */
function slotAmount(s: GTStack): string {
    return formatGTAmount(s.amount, s.fluid, "compact").replace(" ", "");
}

function Slot({ stack, numberFormat }: { stack: GTStack; numberFormat: "full" | "compact" }) {
    return (
        <span className="recipe-slot" title={describe(stack, numberFormat)}>
            <ItemIcon itemid={stack.id} name={stack.name} size={26} />
            {(stack.fluid || stack.amount !== 1) && <span className="recipe-slot__amount">{slotAmount(stack)}</span>}
        </span>
    );
}

function SlotGroup({
    stacks,
    kind,
    numberFormat,
}: {
    stacks: GTStack[];
    kind: "in" | "out";
    numberFormat: "full" | "compact";
}) {
    const shown = stacks.length > CARD_SLOTS ? stacks.slice(0, CARD_SLOTS - 1) : stacks;
    const hidden = stacks.slice(shown.length);
    return (
        <span className={cx("recipe-flow__side", `recipe-flow__side--${kind}`)}>
            {shown.map((s) => (
                <Slot key={s.id} stack={s} numberFormat={numberFormat} />
            ))}
            {hidden.length > 0 && (
                <span
                    className="recipe-slot recipe-slot--more"
                    title={hidden.map((s) => describe(s, numberFormat)).join("\n")}
                >
                    +{hidden.length}
                </span>
            )}
        </span>
    );
}

/**
 * Card strip: inputs, an arrow filled to the recipe's progress, outputs. Without known inputs (a recipe
 * started before a restart, or a machine with its own recipe logic) it shows the outputs alone.
 */
export function RecipeStrip({
    inputs,
    outputs,
    clock,
    numberFormat,
}: {
    inputs: GTStack[];
    outputs: GTStack[];
    /** The running recipe the arrow follows; an empty arrow without one. */
    clock: RecipeClock | null;
    numberFormat: "full" | "compact";
}) {
    if (outputs.length === 0 && inputs.length === 0) return null;
    return (
        <div className="recipe-flow" aria-label="Current recipe">
            {inputs.length > 0 && (
                <>
                    <SlotGroup stacks={inputs} kind="in" numberFormat={numberFormat} />
                    <RecipeArrowIcon size={22} cycle={clock} className="recipe-flow__arrow" />
                </>
            )}
            {outputs.length > 0 && <SlotGroup stacks={outputs} kind="out" numberFormat={numberFormat} />}
        </div>
    );
}

function StackList({
    title,
    stacks,
    numberFormat,
}: {
    title: string;
    stacks: GTStack[];
    numberFormat: "full" | "compact";
}) {
    return (
        <div className="recipe-detail__side">
            <span className="recipe-detail__label">{title}</span>
            {stacks.map((s) => (
                <div key={s.id} className="recipe-detail__row">
                    <ItemIcon itemid={s.id} name={s.name} size={24} />
                    <span className="recipe-detail__name">{s.name}</span>
                    <span className="recipe-detail__amount">{formatGTAmount(s.amount, s.fluid, numberFormat)}</span>
                </div>
            ))}
        </div>
    );
}

/** Drawer version: named inputs and outputs with full amounts, the arrow between them tracking progress. */
export function RecipeDetail({
    inputs,
    outputs,
    progress,
    clock,
    numberFormat,
}: {
    inputs: GTStack[];
    outputs: GTStack[];
    /** 0..1 where a stopped recipe halted; `clock` takes over while it runs. */
    progress: number;
    clock: RecipeClock | null;
    numberFormat: "full" | "compact";
}) {
    return (
        <div className="recipe-detail">
            {inputs.length > 0 ? (
                <StackList title="Inputs" stacks={inputs} numberFormat={numberFormat} />
            ) : (
                <div className="recipe-detail__side">
                    <span className="recipe-detail__label">Inputs</span>
                    <span className="recipe-detail__unknown">
                        Not known for this recipe - it started before the server's last restart, or this machine checks
                        recipes its own way.
                    </span>
                </div>
            )}
            <div className="recipe-detail__arrow">
                <RecipeArrowIcon size={26} fill={progress} cycle={clock} />
                <span>{clock ? <RecipePercent clock={clock} /> : `${Math.round(progress * 100)}%`}</span>
            </div>
            <StackList title="Outputs" stacks={outputs} numberFormat={numberFormat} />
        </div>
    );
}

/** Tiles per side in a table row before the rest fold into "+N". */
const ROW_TILES = 3;

function TileSide({ stacks, numberFormat }: { stacks: GTStack[]; numberFormat: "full" | "compact" }) {
    const shown = stacks.length > ROW_TILES ? stacks.slice(0, ROW_TILES - 1) : stacks;
    const hidden = stacks.slice(shown.length);
    return (
        <>
            {shown.map((s) => (
                <span key={s.id} title={describe(s, numberFormat)} className="recipe-tiles__tile">
                    <ItemIcon itemid={s.id} name={s.name} size={20} />
                </span>
            ))}
            {hidden.length > 0 && (
                <span className="recipe-tiles__more" title={hidden.map((s) => describe(s, numberFormat)).join("\n")}>
                    +{hidden.length}
                </span>
            )}
        </>
    );
}

/** Table-row version: small input tiles → output tiles, names and amounts in their tooltips. */
export function RecipeTiles({
    inputs,
    outputs,
    numberFormat,
}: {
    inputs: GTStack[];
    outputs: GTStack[];
    numberFormat: "full" | "compact";
}) {
    if (outputs.length === 0 && inputs.length === 0) return <span className="recipe-tiles recipe-tiles--none">—</span>;
    return (
        <span className="recipe-tiles" aria-label="Current recipe">
            <TileSide stacks={inputs} numberFormat={numberFormat} />
            {inputs.length > 0 && <span className="recipe-tiles__arrow">→</span>}
            <TileSide stacks={outputs} numberFormat={numberFormat} />
        </span>
    );
}
