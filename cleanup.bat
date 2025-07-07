@echo off
echo Removing redundant files...

del /f "electron\main\services\agentService.ts"
del /f "electron\main\services\hintService.ts"
del /f "electron\main\services\viewManagerService.ts"
del /f "electron\main\services\index.ts"

del /f "electron\main\handlers\aiHandler.ts"
del /f "electron\main\handlers\hintHandler.ts"
del /f "electron\main\handlers\navigationHandler.ts"
del /f "electron\main\handlers\index.ts"

echo Removing empty directories...
rmdir "electron\main\services"
rmdir "electron\main\handlers"

echo Cleanup complete!