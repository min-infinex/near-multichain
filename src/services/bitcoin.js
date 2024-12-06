import * as ethers from 'ethers';
import { fetchJson } from './utils';
import * as bitcoinJs from 'bitcoinjs-lib';
import { generateBtcAddress } from './kdf/btc';
import { MPC_CONTRACT } from './kdf/mpc';
import { Psbt } from 'bitcoinjs-lib/src/psbt';

export class Bitcoin {
  name = 'Bitcoin';
  currency = 'sats';

  constructor(networkId) {
    this.networkId = networkId;
    this.name = `Bitcoin ${networkId === 'testnet' ? 'Testnet' : 'Mainnet'}`;
    this.explorer = `https://blockstream.info/${networkId === 'testnet' ? 'testnet' : ''}`;
  }

  deriveAddress = async (accountId, derivation_path) => {
    const { address, publicKey, nearCompatiblePublicKey } = await generateBtcAddress({
      accountId,
      path: derivation_path,
      isTestnet: true,
      addressType: 'segwit'
    });
    return { address, publicKey, nearCompatiblePublicKey };
  }

  getUtxos = async ({ address }) => {
    const bitcoinRpc = `https://blockstream.info/${this.networkId === 'testnet' ? 'testnet' : ''}/api`;
    try {
      const utxos = await fetchJson(`${bitcoinRpc}/address/${address}/utxo`);
      return utxos;
    } catch (e) { console.log('e', e) }
  }

  getBalance = async ({ address }) => {
    const utxos = await this.getUtxos({ address });
    let balance = utxos.reduce((acc, utxo) => acc + utxo.value, 0);
    return balance;
  }

  createTransaction = async ({ from: address, to, amount }) => {
    let utxos = await this.getUtxos({ address });
    if (!utxos) return

    // Use the utxo with the highest value
    utxos.sort((a, b) => b.value - a.value);
    // utxos = [utxos[0]];

    const psbt = await constructPsbt(address, utxos, to, amount, this.networkId)
    if (!psbt) return

    return { utxos, psbt };
  }

  requestSignatureToMPC = async ({
    wallet,
    path,
    psbt,
    utxos,
    publicKey,
    attachedDeposit = 1,
  }) => {
    let sigs = []
    console.log("psbt", psbt) 
    let fullTransaction = {
      version: psbt.data.globalMap.unsignedTx.tx.version,
      locktime: psbt.data.globalMap.unsignedTx.tx.locktime,
    }

    let ins = psbt.data.globalMap.unsignedTx.tx.ins
    let outs = psbt.data.globalMap.unsignedTx.tx.outs

    fullTransaction.input = ins.map((input, i) => ({
      previous_output: {
        txid: input.hash,
        vout: input.index
      },
      sequence: input.sequence,
    }))

    fullTransaction.output = outs.map((output, i) => ({
      value: output.value,
      script_pubkey: output.script
    }))

    console.log("fullTransaction", fullTransaction)

      // Assuming only 3 transactions at a time     
      // for(let i = 0; i < psbt.data.inputs.length; i+=3) {
      //   const sigRes = await wallet.callMethod({
    //     contractId: "permission.testnet",
    //     method: "permissioned_sign",
    //     args: {
    //       fullTransaction,
    //       indicies: Array.from({ length: 3 }, (_, j) => i + j)
    //     },
    //   })

    //   for(let signature of sigRes) {
    //     let { big_r, s } = signature
    //     // Reconstruct the signature
    //     const rHex = big_r.affine_point.slice(2); // Remove the "03" prefix
    //     let sHex = s.scalar;
       
    //     // Pad s if necessary
    //     if (sHex.length < 64) {
    //       sHex = sHex.padStart(64, '0');
    //     }
       
    //     const rBuf = Buffer.from(rHex, 'hex');
    //     const sBuf = Buffer.from(sHex, 'hex');
       
    //     // Now encode to DER
    //     const derSignature = this.encodeToDER(rBuf, sBuf);
    //     sigs.push(derSignature)
    //   }
    // }

    /*
       // Reconstruct the signature
        const rHex = big_r.affine_point.slice(2); // Remove the "03" prefix
        let sHex = s.scalar;

        // Pad s if necessary
        if (sHex.length < 64) {
          sHex = sHex.padStart(64, '0');
        }

        const rBuf = Buffer.from(rHex, 'hex');
        const sBuf = Buffer.from(sHex, 'hex');

        // Combine r and s
        return Buffer.concat([rBuf, sBuf]);


        // Insert the signature into the PSBT --> need to signature match??? I doubt these will come back in order from MPC, at least assume it does not until proven otherwise
        for (let i = 0; i < inputCount; i++) {
          const derSignature = encodeToDER(signatures[i].r, signatures[i].s);
          psbt.updateInput(i, {
            partialSig: [{
              pubkey: yourPubKeyBuffer,
              signature: derSignature
            }]
          });
        }
    */  

    // psbt.finalizeAllInputs(); // Finalize the PSBT

    // console.log("finalized psbt: ", psbt )

    return null;  // Return the generated signature
  }

  encodeToDER = (r, s) => {
    // Ensure r and s are Buffers. If they are Uint8Arrays, convert them to Buffers.
    // If they're hex strings, you can do: r = Buffer.from(r, 'hex'), etc.
    if (!(r instanceof Buffer)) r = Buffer.from(r);
    if (!(s instanceof Buffer)) s = Buffer.from(s);
  
    // Prepend 0x00 to ensure the integer is positive if MSB is set
    function prependZeroIfNeeded(x) {
      if (x.length === 0) {
        return Buffer.from([0x00]);
      }
      if (x[0] & 0x80) {
        const newBuf = Buffer.alloc(x.length + 1);
        newBuf[0] = 0x00;
        x.copy(newBuf, 1);
        return newBuf;
      }
      return x;
    }
  
    const rEncoded = prependZeroIfNeeded(r);
    const sEncoded = prependZeroIfNeeded(s);
  
    // 2 bytes for R header/length + rEncoded.length
    // 2 bytes for S header/length + sEncoded.length
    // plus 2 bytes for the SEQUENCE header/length
    const totalLen = 2 + rEncoded.length + 2 + sEncoded.length;
    const der = Buffer.alloc(totalLen + 2);
  
    // Construct DER
    der[0] = 0x30; // SEQUENCE tag
    der[1] = totalLen; // length of all the following data
    der[2] = 0x02; // INTEGER tag for R
    der[3] = rEncoded.length;
    rEncoded.copy(der, 4);
  
    const sPos = 4 + rEncoded.length;
    der[sPos] = 0x02; // INTEGER tag for S
    der[sPos + 1] = sEncoded.length;
    sEncoded.copy(der, sPos + 2);
  
    return der;
  }

  /**
 * Compute the sighash for a given input in a PSBT.
 * 
 * @param {Psbt} psbt - The PSBT object from bitcoinjs-lib.
 * @param {number} inputIndex - The index of the input to sign.
 * @param {number} sighashType - The desired sighash type (default SIGHASH_ALL: 0x01).
 * @returns {Buffer} The sighash (32-byte hash that needs to be signed).
 */
 computeSighashForInput = ({
  psbt, 
  inputIndex, 
  sighashType = bitcoinJs.Transaction.SIGHASH_ALL
}) => {
  // Extract the underlying transaction
  // NOTE: We can access the underlying unsigned transaction from the psbt's global map.
  const unsignedTx = psbt.data.globalMap.unsignedTx;
  if (!unsignedTx) {
    throw new Error('PSBT does not have an unsigned transaction.');
  }

  const input = psbt.data.inputs[inputIndex];
  console.log("input",  input)
  if (!input) {
    throw new Error(`Input at index ${inputIndex} does not exist.`);
  }

  const txForSighash = unsignedTx.tx;
  
  let script;
  let value;

  // Determine input type and retrieve necessary data
  if (input.witnessUtxo) {
    console.log("witnessUtxo: ", input.witnessUtxo)
    // SegWit input
    script = input.witnessUtxo.script;
    value = input.witnessUtxo.value;

    // For SegWit v0 inputs:
    // hashForWitnessV0(inputIndex, script, value, sighashType) 
    return txForSighash.hashForWitnessV0(inputIndex, script, value, sighashType);
  } else if (input.nonWitnessUtxo) {
    // Legacy input
    // Extract the previous transaction to find the scriptPubKey
    const prevTx = bitcoinJs.Transaction.fromBuffer(input.nonWitnessUtxo);
    const prevOutIndex = txForSighash.ins[inputIndex].index;
    
    if (prevOutIndex >= prevTx.outs.length) {
      throw new Error(`Invalid prevOutIndex ${prevOutIndex} for nonWitnessUtxo.`);
    }

    script = prevTx.outs[prevOutIndex].script;
    // In legacy transactions, value is not strictly required for sighash computation.
    // However, for completeness, you can store it if you need it (not needed for legacy sighash).
    
    // For Legacy inputs:
    return txForSighash.hashForSignature(inputIndex, script, sighashType);
  } else {
    throw new Error('No witnessUtxo or nonWitnessUtxo provided for this input.');
  }
}

  broadcastTX = async (signedTransaction) => {
    // broadcast tx
    const bitcoinRpc = `https://blockstream.info/${this.networkId === 'testnet' ? 'testnet' : ''}/api`;
    const res = await fetch(`https://corsproxy.io/?${bitcoinRpc}/tx`, {
      method: 'POST',
      body: signedTransaction.extractTransaction().toHex(),
    });
    if (res.status === 200) {
      const hash = await res.text();
      return hash
    } else {
      throw Error(res);
    }
  }
}

async function getFeeRate(networkId, blocks = 6) {
  const bitcoinRpc = `https://blockstream.info/${networkId === 'testnet' ? 'testnet' : ''}/api`;
  const rate = await fetchJson(`${bitcoinRpc}/fee-estimates`);
  return rate[blocks].toFixed(0);
}

async function constructPsbt(
  address,
  utxos,
  to,
  amount,
  networkId,
) {

  if (!address) return console.log('must provide a sending address');
  const sats = parseInt(amount);

  // Check balance (TODO include fee in check)
  if (utxos[0].value < sats) {
    return console.log('insufficient funds');
  }

  const psbt = new bitcoinJs.Psbt({ network: networkId === 'testnet' ? bitcoinJs.networks.testnet : bitcoinJs.networks.bitcoin });

  let totalInput = 0;

  await Promise.all(
    utxos.map(async (utxo) => {
      console.log("utxo", utxo)
      totalInput += utxo.value;

      const transaction = await fetchTransaction(networkId, utxo.txid);
      let inputOptions;

      const scriptHex = transaction.outs[utxo.vout].script.toString('hex');
      console.log(`UTXO script type: ${scriptHex}`);

      if (scriptHex.startsWith('76a914')) {
        console.log('legacy');
        const nonWitnessUtxo = await fetch(`${bitcoinRpc}/tx/${utxo.txid}/hex`).then(result => result.text())

        console.log('nonWitnessUtxo hex:', nonWitnessUtxo)
        // Legacy P2PKH input (non-SegWit)
        inputOptions = {
          hash: utxo.txid,
          index: utxo.vout,
          nonWitnessUtxo: Buffer.from(nonWitnessUtxo, 'hex'), // Provide the full transaction hex
          // sequence: 4294967295, // Enables RBF
        };
      } else if (scriptHex.startsWith('0014')) {
        console.log('segwit');

        inputOptions = {
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: transaction.outs[utxo.vout].script,
            value: utxo.value,  // Amount in satoshis
          },
        };
      } else if (scriptHex.startsWith('0020') || scriptHex.startsWith('5120')) {
        console.log('taproot');

        // Taproot (P2TR) input
        inputOptions = {
          hash: utxo.txid,
          index: utxo.vout,
          witnessUtxo: {
            script: transaction.outs[utxo.vout].script,
            value: utxo.value,
          },
          tapInternalKey: 'taprootInternalPubKey' // Add your Taproot internal public key here
        };
      } else {
        throw new Error('Unknown script type');
      }

      // Add the input to the PSBT
      psbt.addInput(inputOptions);
    })
  );

  // Add output to the recipient
  psbt.addOutput({
    address: to,
    value: sats,
  });

  // Calculate fee (replace with real fee estimation)
  const feeRate = await getFeeRate(networkId);
  const estimatedSize = utxos.length * 148 + 2 * 34 + 10;
  const fee = (estimatedSize * feeRate).toFixed(0);
  const change = totalInput - sats - fee;

  // Add change output if necessary
  if (change > 0) {
    psbt.addOutput({
      address: address,
      value: Math.floor(change),
    });
  }

  return psbt;
};

async function fetchTransaction(networkId, transactionId) {
  const bitcoinRpc = `https://blockstream.info/${networkId === 'testnet' ? 'testnet' : ''}/api`;

  const data = await fetchJson(`${bitcoinRpc}/tx/${transactionId}`);
  const tx = new bitcoinJs.Transaction();

  if (!data || !tx) throw new Error('Failed to fetch transaction')
  tx.version = data.version;
  tx.locktime = data.locktime;

  data.vin.forEach((vin) => {
    const txHash = Buffer.from(vin.txid, 'hex').reverse();
    const vout = vin.vout;
    const sequence = vin.sequence;
    const scriptSig = vin.scriptsig
      ? Buffer.from(vin.scriptsig, 'hex')
      : undefined;
    tx.addInput(txHash, vout, sequence, scriptSig);
  });

  data.vout.forEach((vout) => {
    const value = vout.value;
    const scriptPubKey = Buffer.from(vout.scriptpubkey, 'hex');
    tx.addOutput(scriptPubKey, value);
  });

  data.vin.forEach((vin, index) => {
    if (vin.witness && vin.witness.length > 0) {
      const witness = vin.witness.map((w) => Buffer.from(w, 'hex'));
      tx.setWitness(index, witness);
    }
  });

  return tx;
}