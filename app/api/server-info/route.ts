import { NextResponse } from 'next/server';
import { networkInterfaces } from 'os';

export async function GET() {
  try {
    const nets = networkInterfaces();
    const results: string[] = [];

    for (const name of Object.keys(nets)) {
      const netInfo = nets[name];
      if (!netInfo) continue;

      for (const net of netInfo) {
        const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4;
        if (net.family === familyV4Value && !net.internal) {
          results.push(net.address);
        }
      }
    }

    const port = process.env.PORT || 43214;
    const localAddress = results[0] || 'localhost';
    
    return NextResponse.json({ 
      address: `http://${localAddress}:${port}`,
      ip: localAddress,
      port: port
    });
  } catch (error) {
    console.error('Server info error:', error);
    return NextResponse.json({ 
      address: 'Unable to detect',
      error: 'Failed to get network info' 
    }, { status: 500 });
  }
}
