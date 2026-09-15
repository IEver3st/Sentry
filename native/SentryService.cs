using System;
using System.IO;
using System.Diagnostics;
using System.ServiceProcess;
using System.Web.Script.Serialization;
using System.Collections.Generic;

// SCM owns this small native host. Electron main owns credentials and native policy;
// its existing isolated engine worker still owns SQLite, scanning and transfers.
public sealed class SentryService : ServiceBase {
    private Process child;
    private readonly Dictionary<string, object> config;
    public SentryService() {
        config = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "service-config.json")));
        ServiceName = (string)config["name"];
        CanShutdown = true;
        AutoLog = false;
    }
    protected override void OnStart(string[] args) {
        var executable = (string)config["executable"];
        var start = new ProcessStartInfo(executable, "--service-host --background") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, WorkingDirectory = Path.GetDirectoryName(executable) };
        start.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
        start.EnvironmentVariables["SENTRY_DATA_DIR"] = (string)config["data"];
        start.EnvironmentVariables["SENTRY_SERVICE"] = "1";
        start.EnvironmentVariables["SENTRY_GOOGLE_CLIENT_ID"] = Environment.GetEnvironmentVariable("SENTRY_GOOGLE_CLIENT_ID") ?? "";
        child = Process.Start(start);
        child.EnableRaisingEvents = true;
        child.Exited += delegate { if (child.ExitCode != 0) Environment.Exit(1); else Stop(); };
    }
    protected override void OnStop() {
        if (child == null || child.HasExited) return;
        // Main watches this non-secret stop marker and cancels work gracefully.
        File.WriteAllText(Path.Combine((string)config["data"], "service-stop"), "stop");
        RequestAdditionalTime(30000);
        if (!child.WaitForExit(25000)) {
            var kill = Process.Start(new ProcessStartInfo("taskkill.exe", "/PID " + child.Id + " /T /F") { UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden });
            kill.WaitForExit(5000);
        }
    }
    protected override void OnShutdown() { OnStop(); }
    public static void Main() { ServiceBase.Run(new SentryService()); }
}
