#!/bin/bash

# Antigravity Mobile — Right-Click Context Menu Installer (macOS)
# Creates a Finder Quick Action: Right-click folder → "Open with Antigravity + MobileWork"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVICE_NAME="Open with Antigravity + MobileWork"
SERVICE_DIR="$HOME/Library/Services"
WORKFLOW_PATH="$SERVICE_DIR/$SERVICE_NAME.workflow"

install_service() {
    echo ""
    echo "[INSTALL] Creating Quick Action..."
    echo ""

    # Remove old workflows with different names
    rm -rf "$SERVICE_DIR/Open with Antigravity (Debug).workflow" 2>/dev/null

    mkdir -p "$SERVICE_DIR"
    rm -rf "$WORKFLOW_PATH"

    # The shell command that runs when user clicks the context menu
    # Uses the v2 TypeScript launcher instead of legacy http-server.mjs
    mkdir -p "$WORKFLOW_PATH/Contents"

    # Info.plist — marks this as a Quick Action (Services Menu)
    cat > "$WORKFLOW_PATH/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>NSServices</key>
	<array>
		<dict>
			<key>NSMenuItem</key>
			<dict>
				<key>default</key>
				<string>Open with Antigravity + MobileWork</string>
			</dict>
			<key>NSMessage</key>
			<string>runWorkflowAsService</string>
			<key>NSSendFileTypes</key>
			<array>
				<string>public.folder</string>
			</array>
		</dict>
	</array>
</dict>
</plist>
EOF

    # document.wflow — the actual workflow with shell script action
    cat > "$WORKFLOW_PATH/Contents/document.wflow" << WFLOWEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>AMApplicationBuild</key>
	<string>523</string>
	<key>AMApplicationVersion</key>
	<string>2.10</string>
	<key>AMDocumentVersion</key>
	<string>2</string>
	<key>actions</key>
	<array>
		<dict>
			<key>action</key>
			<dict>
				<key>AMAccepts</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Optional</key>
					<true/>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.path</string>
					</array>
				</dict>
				<key>AMActionVersion</key>
				<string>2.0.3</string>
				<key>AMApplication</key>
				<array>
					<string>Automator</string>
				</array>
				<key>AMBundleIdentifier</key>
				<string>com.apple.RunShellScript</string>
				<key>AMCategory</key>
				<string>AMCategoryUtilities</string>
				<key>AMIconName</key>
				<string>Automator</string>
				<key>AMName</key>
				<string>Run Shell Script</string>
				<key>AMProvides</key>
				<dict>
					<key>Container</key>
					<string>List</string>
					<key>Types</key>
					<array>
						<string>com.apple.cocoa.path</string>
					</array>
				</dict>
				<key>ActionBundlePath</key>
				<string>/System/Library/Automator/Run Shell Script.action</string>
				<key>ActionName</key>
				<string>Run Shell Script</string>
				<key>ActionParameters</key>
				<dict>
					<key>COMMAND_STRING</key>
					<string>for f in "\$@"; do
    DIR="\$f"
    if [ ! -d "\$DIR" ]; then
        DIR="\$(dirname "\$f")"
    fi
    open -a Terminal "\$DIR"
    sleep 0.5
    osascript -e "tell application \"Terminal\"" -e "do script \"cd '\$DIR' &amp;&amp; cd '$SCRIPT_DIR/server' &amp;&amp; npx tsx src/launcher.ts\" in front window" -e "end tell"
    break
done</string>
					<key>CheckedForUserDefaultShell</key>
					<true/>
					<key>inputMethod</key>
					<integer>1</integer>
					<key>shell</key>
					<string>/bin/bash</string>
					<key>source</key>
					<string></string>
				</dict>
				<key>BundleIdentifier</key>
				<string>com.apple.Automator.RunShellScript</string>
				<key>CFBundleVersion</key>
				<string>2.0.3</string>
				<key>CanShowSelectedItemsWhenRun</key>
				<false/>
				<key>CanShowWhenRun</key>
				<true/>
				<key>Category</key>
				<array>
					<string>AMCategoryUtilities</string>
				</array>
				<key>Class Name</key>
				<string>RunShellScriptAction</string>
				<key>InputUUID</key>
				<string>A1B2C3D4-E5F6-7890-ABCD-EF1234567890</string>
				<key>Keywords</key>
				<array>
					<string>Shell</string>
					<string>Script</string>
				</array>
				<key>OutputUUID</key>
				<string>B2C3D4E5-F6A7-8901-BCDE-F12345678901</string>
				<key>UUID</key>
				<string>C3D4E5F6-A7B8-9012-CDEF-123456789012</string>
				<key>UnlocalizedApplications</key>
				<array>
					<string>Automator</string>
				</array>
				<key>arguments</key>
				<dict>
					<key>0</key>
					<dict>
						<key>default value</key>
						<integer>0</integer>
						<key>name</key>
						<string>inputMethod</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>0</string>
					</dict>
					<key>1</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>source</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>1</string>
					</dict>
					<key>2</key>
					<dict>
						<key>default value</key>
						<false/>
						<key>name</key>
						<string>CheckedForUserDefaultShell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>2</string>
					</dict>
					<key>3</key>
					<dict>
						<key>default value</key>
						<string></string>
						<key>name</key>
						<string>COMMAND_STRING</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>3</string>
					</dict>
					<key>4</key>
					<dict>
						<key>default value</key>
						<string>/bin/sh</string>
						<key>name</key>
						<string>shell</string>
						<key>required</key>
						<string>0</string>
						<key>type</key>
						<string>0</string>
						<key>uuid</key>
						<string>4</string>
					</dict>
				</dict>
				<key>isViewVisible</key>
				<true/>
				<key>location</key>
				<string>449.000000:620.000000</string>
				<key>nibPath</key>
				<string>/System/Library/Automator/Run Shell Script.action/Contents/Resources/Base.lproj/main.nib</string>
			</dict>
		</dict>
	</array>
	<key>connectors</key>
	<dict/>
	<key>workflowMetaData</key>
	<dict>
		<key>serviceInputTypeIdentifier</key>
		<string>com.apple.Automator.fileSystemObject</string>
		<key>serviceOutputTypeIdentifier</key>
		<string>com.apple.Automator.nothing</string>
		<key>serviceProcessesInput</key>
		<integer>0</integer>
		<key>workflowTypeIdentifier</key>
		<string>com.apple.Automator.servicesMenu</string>
	</dict>
</dict>
</plist>
WFLOWEOF

    # Flush services cache
    /System/Library/CoreServices/pbs -flush 2>/dev/null
    # Also update launch services
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -kill -r -domain local -domain system -domain user 2>/dev/null

    echo "[SUCCESS] Quick Action installed!"
    echo ""
    echo "  Path: $WORKFLOW_PATH"
    echo ""
    echo "  Usage:"
    echo "    1. Right-click any folder in Finder"
    echo "    2. Look for 'Quick Actions' submenu"
    echo "    3. Click 'Open with Antigravity + MobileWork'"
    echo ""
    echo "  If not visible yet, try:"
    echo "    - Log out and log back in"
    echo "    - Or restart Finder: killall Finder"
}

remove_service() {
    echo ""
    if [ -d "$WORKFLOW_PATH" ]; then
        rm -rf "$WORKFLOW_PATH"
        /System/Library/CoreServices/pbs -flush 2>/dev/null
        echo "[SUCCESS] Quick Action removed!"
    else
        echo "[INFO] No Antigravity Quick Action found."
    fi
}

check_status() {
    echo ""
    if [ -d "$WORKFLOW_PATH" ]; then
        echo "[INSTALLED] $WORKFLOW_PATH"
        echo ""
        ls -la "$WORKFLOW_PATH/Contents/"
    else
        echo "[NOT INSTALLED]"
    fi
}

# Interactive menu
clear
echo "==================================================="
echo "  Antigravity — Context Menu Installer (macOS)"
echo "==================================================="
echo ""
echo "  [1] Install   — Add right-click Quick Action"
echo "  [2] Remove    — Remove Quick Action"
echo "  [3] Status    — Check installation"
echo "  [4] Exit"
echo ""
read -p "Choose (1-4): " choice

case $choice in
    1) install_service ;;
    2) remove_service ;;
    3) check_status ;;
    4) echo "Bye." ;;
    *) echo "[ERROR] Invalid." ;;
esac
