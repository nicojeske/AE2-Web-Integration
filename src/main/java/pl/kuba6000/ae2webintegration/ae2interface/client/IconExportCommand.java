package pl.kuba6000.ae2webintegration.ae2interface.client;

import java.util.List;

import net.minecraft.command.CommandBase;
import net.minecraft.command.CommandException;
import net.minecraft.command.ICommandSender;
import net.minecraft.command.WrongUsageException;

/** Client-side {@code /ae2webicons export [size]}: starts an {@link IconExporter} run. */
public class IconExportCommand extends CommandBase {

    private static final String USAGE = "/ae2webicons export [size in px, multiple of 16, default 64]";

    @Override
    public String getCommandName() {
        return "ae2webicons";
    }

    @Override
    public String getCommandUsage(ICommandSender sender) {
        return USAGE;
    }

    @Override
    public int getRequiredPermissionLevel() {
        return 0;
    }

    @Override
    public boolean canCommandSenderUseCommand(ICommandSender sender) {
        return true;
    }

    @Override
    public void processCommand(ICommandSender sender, String[] args) {
        if (args.length < 1 || args.length > 2 || !"export".equals(args[0])) {
            throw new WrongUsageException(USAGE);
        }
        int size = args.length == 2 ? parseIntBounded(sender, args[1], 16, 256) : 64;
        if (size % 16 != 0) {
            throw new WrongUsageException(USAGE);
        }
        String error = IconExporter.start(size);
        if (error != null) {
            throw new CommandException(error);
        }
    }

    @Override
    public List<String> addTabCompletionOptions(ICommandSender sender, String[] args) {
        return args.length == 1 ? getListOfStringsMatchingLastWord(args, "export") : null;
    }
}
