// The recipe a GregTech machine is running, as inputs -> outputs. A compact strip of item slots for the
// machine cards (amount overlaid on the icon like an inventory slot) and a labelled list for the drawer.
import type { GTStack } from "../api/types";
import { cx } from "../ui/cx";
import { RecipeArrowIcon } from "../ui/icons";
import { ItemIcon } from "../ui/ItemIcon";
import { formatGTAmount } from "./gtModel";

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
    progress,
    numberFormat,
}: {
    inputs: GTStack[];
    outputs: GTStack[];
    progress: number;
    numberFormat: "full" | "compact";
}) {
    if (outputs.length === 0 && inputs.length === 0) return null;
    return (
        <div className="recipe-flow" aria-label="Current recipe">
            {inputs.length > 0 && (
                <>
                    <SlotGroup stacks={inputs} kind="in" numberFormat={numberFormat} />
                    <RecipeArrowIcon size={22} fill={progress} className="recipe-flow__arrow" />
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
    numberFormat,
}: {
    inputs: GTStack[];
    outputs: GTStack[];
    progress: number;
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
                <RecipeArrowIcon size={26} fill={progress} />
                <span>{Math.round(progress * 100)}%</span>
            </div>
            <StackList title="Outputs" stacks={outputs} numberFormat={numberFormat} />
        </div>
    );
}
