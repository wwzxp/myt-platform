$src = 'C:\Windows\System32\bash.exe'
$bak = 'C:\Windows\System32\bash.exe.wslbak'
$log = 'F:\ai\myt_tools\.rename-result.txt'
"=== 改名前 ===" | Out-File $log -Encoding utf8
"存在: $(Test-Path $src)" | Out-File $log -Append -Encoding utf8
try {
  if (Test-Path $bak) { "备份已存在，跳过改名" | Out-File $log -Append -Encoding utf8 }
  else { Move-Item $src $bak -ErrorAction Stop; "已改名 → bash.exe.wslbak" | Out-File $log -Append -Encoding utf8 }
} catch {
  "失败: $($_.Exception.Message)" | Out-File $log -Append -Encoding utf8
}
"=== 改名后 ===" | Out-File $log -Append -Encoding utf8
"bash 解析: $((Get-Command bash -ErrorAction SilentlyContinue).Source)" | Out-File $log -Append -Encoding utf8
"uname: $(bash -c 'uname -s' 2>&1)" | Out-File $log -Append -Encoding utf8
