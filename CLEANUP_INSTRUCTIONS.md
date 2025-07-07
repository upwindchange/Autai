# Cleanup Instructions

Due to a technical issue with the bash environment, please manually delete the following files and directories:

## Files to Delete:
1. `electron/main/services/agentService.ts`
2. `electron/main/services/hintService.ts`
3. `electron/main/services/viewManagerService.ts`
4. `electron/main/services/index.ts`
5. `electron/main/handlers/aiHandler.ts`
6. `electron/main/handlers/hintHandler.ts`
7. `electron/main/handlers/navigationHandler.ts`
8. `electron/main/handlers/index.ts`

## Empty Directories to Remove:
1. `electron/main/services/`
2. `electron/main/handlers/`

## How to Delete:

### Option 1: Using Command Prompt (Windows)
Open Command Prompt in the project directory and run:
```cmd
del /f "electron\main\services\agentService.ts"
del /f "electron\main\services\hintService.ts"
del /f "electron\main\services\viewManagerService.ts"
del /f "electron\main\services\index.ts"
del /f "electron\main\handlers\aiHandler.ts"
del /f "electron\main\handlers\hintHandler.ts"
del /f "electron\main\handlers\navigationHandler.ts"
del /f "electron\main\handlers\index.ts"
rmdir "electron\main\services"
rmdir "electron\main\handlers"
```

### Option 2: Using PowerShell
Open PowerShell in the project directory and run:
```powershell
Remove-Item -Path "electron/main/services/*.ts" -Force
Remove-Item -Path "electron/main/handlers/*.ts" -Force
Remove-Item -Path "electron/main/services" -Force
Remove-Item -Path "electron/main/handlers" -Force
```

### Option 3: Using the Node.js Script
Run the cleanup.js script I created:
```bash
node cleanup.js
```

### Option 4: Using the Batch File
Run the cleanup.bat file I created:
```cmd
cleanup.bat
```

These files were created by mistake as the functionality already exists in:
- `navigationHandlers.ts`
- `ipcHandlers.ts`
- `viewManager.ts`
- `agent.ts`