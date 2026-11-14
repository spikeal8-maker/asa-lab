#Requires -Version 5.1
<#
Trust the installation-owned ASA Lab local HTTPS CA for the CURRENT Windows user.
The owner must explicitly invoke -TrustLocalServer. Only a PUBLIC certificate is
copied from the known SSH host; no private key or password is read or exported.
A SHA256 digest obtained independently over authenticated SSH is mandatory.
This changes the current user's certificate trust store, not DNS/VPN/firewall.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^\d{1,3}(\.\d{1,3}){3}$')]
    [string]$Server,
    [ValidatePattern('^[a-z_][a-z0-9_-]{0,31}$')]
    [string]$SshUser = 'admins',
    [Parameter(Mandatory=$true)]
    [ValidatePattern('^[a-fA-F0-9]{64}$')]
    [string]$ExpectedCaSha256,
    [switch]$TrustLocalServer
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $TrustLocalServer) {
    throw 'Read the script and explicitly pass -TrustLocalServer to trust your own server CA.'
}
$ip = [System.Net.IPAddress]::Parse($Server)
$b = $ip.GetAddressBytes()
$isPrivate = ($b.Length -eq 4) -and (($b[0] -eq 10) -or
    (($b[0] -eq 172) -and ($b[1] -ge 16) -and ($b[1] -le 31)) -or
    (($b[0] -eq 192) -and ($b[1] -eq 168)))
if (-not $isPrivate) { throw 'Only the explicitly selected private LAN server is supported.' }
$ssh = (Get-Command ssh.exe -ErrorAction Stop).Source
$scp = (Get-Command scp.exe -ErrorAction Stop).Source
$local = Join-Path $env:TEMP ('asa-lab-' + $Server + '-root.cer')
$remote = '/home/' + $SshUser + '/asa-lab-public-root.cer'
$source = '/var/lib/asa-lan-https/caddy/pki/authorities/local/root.crt'
$target = $SshUser + '@' + $Server
Write-Host 'Exporting only the PUBLIC local CA certificate via known-host SSH.'
Write-Host 'Enter your Ubuntu SSH/sudo password when prompted. It is not logged.'
$export = "sudo sh -c 'umask 022; openssl x509 -in $source -outform DER -out $remote; chmod 0644 $remote'"
& $ssh '-tt' '-o' 'StrictHostKeyChecking=yes' $target $export
if ($LASTEXITCODE -ne 0) { throw 'Certificate export failed; trust store was not changed.' }
& $scp '-o' 'StrictHostKeyChecking=yes' ($target + ':' + $remote) $local
if ($LASTEXITCODE -ne 0) { throw 'Public certificate copy failed; trust store was not changed.' }
if ((Get-Item -LiteralPath $local).Length -gt 32768) { throw 'Unexpected certificate size.' }
$actual = (Get-FileHash -LiteralPath $local -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -cne $ExpectedCaSha256.ToLowerInvariant()) {
    throw 'CA fingerprint differs from authenticated server evidence. Refusing to trust.'
}
$cert = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($local)
if ($cert.HasPrivateKey) { throw 'Only a public certificate may be imported.' }
if (($cert.NotAfter -lt (Get-Date)) -or ($cert.NotBefore -gt (Get-Date))) {
    throw 'Certificate is outside its validity period.'
}
$constraints = @($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.19' })
if ($constraints.Count -ne 1 -or -not $constraints[0].CertificateAuthority) {
    throw 'Expected installation-owned local CA certificate.'
}
$certPath = 'Cert:\CurrentUser\Root\' + $cert.Thumbprint
if (-not (Test-Path -LiteralPath $certPath)) {
    Import-Certificate -FilePath $local -CertStoreLocation 'Cert:\CurrentUser\Root' | Out-Null
}
if (-not (Test-Path -LiteralPath $certPath)) { throw 'Certificate was not installed.' }
Write-Host ('TRUSTED_CA_SHA256=' + $actual)
Write-Host ('TRUSTED_CA_THUMBPRINT=' + $cert.Thumbprint)
Write-Host ('To revoke this trust later: Remove-Item -LiteralPath ' + $certPath)
Write-Host 'Private keys remain on Ubuntu. No Tailscale/router/DNS settings were modified.'
Start-Process ('https://' + $Server + ':4610/#/sign-in')
